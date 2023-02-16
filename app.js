const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_CODE", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

const convertDbObjToResponseObj = (eachTweet) => {
  return {
    username: eachTweet.username,
    tweet: eachTweet.tweet,
    dateTime: eachTweet.date_time,
  };
};

//API 1 register

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUser = `SELECT * FROM user WHERE username='${username}'`;
  const userData = await db.get(getUser);
  if (userData !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    const passwordLength = password.length;
    if (passwordLength < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUser = `INSERT INTO user (name,username,password,gender)
        VALUES('${name}','${username}','${hashedPassword}','${gender}')`;
      const dbResponse = await db.run(createUser);
      const user_id = dbResponse.lastID;
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//API 2 login

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUser = `SELECT * FROM user WHERE username='${username}'`;
  const userData = await db.get(getUser);
  if (userData === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (isPasswordValid === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_CODE");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3 get FEED
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserTweets = `SELECT * 
      FROM user LEFT JOIN tweet ON user.user_id=tweet.user_id 
      WHERE tweet.user_id IN(
          SELECT following_user_id FROM follower LEFT JOIN user 
      ON follower_user_id = user.user_id
      ) ORDER BY tweet.date_time DESC LIMIT 4`;
  const userData = await db.all(getUserTweets);
  response.send(
    userData.map((eachTweet) => convertDbObjToResponseObj(eachTweet))
  );
});

//API 4 user Following

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserFollowing = `SELECT name FROM user WHERE user.user_id IN(
        SELECT following_user_id FROM user LEFT JOIN follower ON
         user.user_id=follower_user_id WHERE user.username='${username}'
        )`;
  const userData = await db.all(getUserFollowing);
  response.send(userData);
});

//API 5 user Followers

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserFollowing = `SELECT name FROM user WHERE user.user_id IN(
        SELECT follower_user_id FROM user LEFT JOIN follower ON
         user.user_id=following_user_id WHERE user.username='${username}'
        )`;
  const userData = await db.all(getUserFollowing);
  response.send(userData);
});

//API 6 tweets
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `
   SELECT
      UF.tweet AS tweet,
      (SELECT DISTINCT COUNT() FROM like WHERE tweet_id = "${tweetId}") AS likes,
      (SELECT DISTINCT COUNT() FROM reply WHERE tweet_id = "${tweetId}") AS replies,
       tweet.date_time AS dateTime
       FROM
       (follower INNER JOIN
       tweet ON follower.following_user_id = tweet.user_id) AS UF
        WHERE
        UF.follower_user_id = 
        (SELECT
        user_id
        FROM
            user
        WHERE
            username = "${username}")
        AND
        UF.tweet_id = "${tweetId}";`;
  const tweetDetails = await db.get(getTweetQuery);
  if (tweetDetails === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send(tweetDetails);
  }
});
//API 7 tweet Likes
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const username = request.username;
    const { tweetId } = request.params;

    const getLikeUserQuery = `
    SELECT
        user.username AS username
    FROM
        (follower INNER JOIN
        tweet ON follower.following_user_id = tweet.user_id) AS UF
        INNER JOIN like ON UF.tweet_id = like.tweet_id
        INNER JOIN user ON like.user_id = user.user_id
    WHERE
        UF.follower_user_id = 
        (SELECT
            user_id
        FROM
            user
        WHERE
            username = "${username}")
        AND
        UF.tweet_id = "${tweetId}";`;
    const dbResponse = await db.all(getLikeUserQuery);
    let likesObj = { likes: dbResponse.map((item) => item.username) };

    if (likesObj.likes.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send(likesObj);
    }
  }
);

//API 8 tweet Replies
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const username = request.username;
    const { tweetId } = request.params;

    const getRepliesQuery = `
    SELECT
        user.name AS name,
        reply.reply AS reply
    FROM
        (follower INNER JOIN
        tweet ON follower.following_user_id = tweet.user_id) AS UF
        INNER JOIN reply ON UF.tweet_id = reply.tweet_id
        INNER JOIN user ON reply.user_id = user.user_id
    WHERE
        UF.follower_user_id = 
        (SELECT
            user_id
        FROM
            user
        WHERE
            username = "${username}")
        AND
        UF.tweet_id = "${tweetId}";`;
    const replies = await db.all(getRepliesQuery);

    if (replies.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({ replies: replies });
    }
  }
);

//API 9 user Tweets
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;

  const getTweetsQuery = `
    SELECT
        tweet,
        COUNT(DISTINCT like_id) AS likes,
        COUNT(DISTINCT reply_id) AS replies,
        tweet.date_time AS dateTime
    FROM
        user 
        NATURAL JOIN tweet
        INNER JOIN like ON tweet.tweet_id = like.tweet_id
        INNER JOIN reply on tweet.tweet_id = reply.tweet_id
    WHERE
        username = "${username}"
    GROUP BY
        tweet.tweet_id;`;
  const tweetsArray = await db.all(getTweetsQuery);
  response.send(tweetsArray);
});

//API 10 user Tweet Posting
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;
  const { tweet } = request.body;

  const createTweetQuery = `
    INSERT INTO
        tweet(tweet, user_id)
        VALUES
            (
            "${tweet}",
        (SELECT user_id FROM user WHERE username = "${username}"));`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//API 11 delete Tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const username = request.username;
    const { tweetId } = request.params;

    const deleteTweetQuery = `
        DELETE FROM
        tweet
        WHERE
        tweet_id = ${tweetId}
        AND
        user_id = (SELECT user_id FROM user WHERE username = "${username}");`;
    const deleteTweet = await db.run(deleteTweetQuery);
    if (deleteTweet.changes === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
