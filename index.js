import express from 'express';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import session from 'express-session';
import bcrypt from 'bcrypt';
import 'dotenv/config';

const app = express();
const publicPath = path.resolve('public');
app.use(express.static(publicPath));
app.set("view engine", 'ejs');

// ---------------------- DATABASE ----------------------
const dbName = "node-project";
const todoCollection = "todo";
const userCollection = "users";
const client = new MongoClient(process.env.MONGO_URI);

const connection = async () => {
    try {
        await client.connect();
        console.log("✅ Connected to MongoDB Atlas");
        return client.db(dbName);
    } catch (err) {
        console.error("❌ MongoDB connection error:", err);
        process.exit(1);
    }
};

// ---------------------- MIDDLEWARE ----------------------
app.use(express.urlencoded({ extended: false }));

// SESSION
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
    })
);

// Make session available in EJS
app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});

// AUTH CHECK
function checkAuth(req, resp, next) {
    if (!req.session.user) return resp.redirect("/login");
    next();
}

// ---------------------- AUTH ROUTES ----------------------

// LOGIN PAGE
app.get("/login", (req, res) => {
    res.render("login", { error: "" });
});

// LOGIN POST
app.post("/login", async (req, res) => {
    const db = await connection();
    const users = db.collection(userCollection);

    const { email, password } = req.body;
    const user = await users.findOne({ email });

    if (!user) return res.render("login", { error: "User not found!" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render("login", { error: "Incorrect password!" });

    req.session.user = user;
    res.redirect("/");
});

// REGISTER PAGE
app.get("/register", (req, res) => {
    res.render("register", { error: "" });
});

// REGISTER POST
app.post("/register", async (req, res) => {
    const db = await connection();
    const users = db.collection(userCollection);

    const { name, email, password } = req.body;
    const existing = await users.findOne({ email });
    if (existing) return res.render("register", { error: "Email already registered!" });

    const hashed = await bcrypt.hash(password, 10);

    await users.insertOne({
        name,
        email,
        password: hashed,
        created_at: new Date(),
    });

    res.redirect("/login"); // do NOT auto-login
});

// LOGOUT
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login");
});

// ---------------------- TODO ROUTES ----------------------

// LIST TASKS → Show ALL tasks
app.get("/", checkAuth, async (req, resp) => {
    const db = await connection();
    const collection = db.collection(todoCollection);

    const result = await collection.find().toArray(); // all tasks
    resp.render("list", { result });
});

// ADD TASK PAGE
app.get("/add", checkAuth, (req, resp) => {
    resp.render("add", { success: req.query.success });
});

// ADD TASK POST
app.post("/add", checkAuth, async (req, resp) => {
    try {
        const db = await connection();
        const collection = db.collection(todoCollection);

        const today = new Date();
        const formattedDate = today.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
        const descriptionWithDate = `[Added on: ${formattedDate}] ${req.body.description}`;

        const newTask = {
            title: req.body.title,
            description: descriptionWithDate,
            userId: req.session.user._id,
            userName: req.session.user.name,
            completed: false,
            created_at: today
        };

        const result = await collection.insertOne(newTask);

        if (result.insertedId) resp.redirect("/add?success=1");
        else resp.redirect("/add?success=0");
    } catch (err) {
        console.log(err);
        resp.redirect("/add?success=0");
    }
});

// DELETE TASK → Only owner can delete
app.get("/delete/:id", checkAuth, async (req, resp) => {
    try {
        const db = await connection();
        const collection = db.collection(todoCollection);

        const result = await collection.deleteOne({
            _id: new ObjectId(req.params.id),
            userId: req.session.user._id
        });

        if (result.deletedCount > 0) resp.redirect("/");
        else resp.send("❌ You can delete only your own tasks!");
    } catch (err) {
        console.log(err);
        resp.send("Error deleting task");
    }
});

// UPDATE TASK PAGE → Only owner can update
app.get("/update/:id", checkAuth, async (req, resp) => {
    const db = await connection();
    const collection = db.collection(todoCollection);

    const result = await collection.findOne({
        _id: new ObjectId(req.params.id),
        userId: req.session.user._id
    });

    if (result) resp.render("update", { result });
    else resp.send("❌ You can update only your own tasks!");
});

// UPDATE TASK POST → Only owner can update
app.post("/update/:id", checkAuth, async (req, resp) => {
    const db = await connection();
    const collection = db.collection(todoCollection);

    const id = req.params.id;
    const { title, description } = req.body;

    const task = await collection.findOne({ _id: new ObjectId(id) });
    let updatedDescription = description;

    if (task && task.description.startsWith("[Added on:")) {
        const datePart = task.description.split("]")[0] + "]";
        updatedDescription = `${datePart} ${description.replace(datePart, "").trim()}`;
    }

    const result = await collection.updateOne(
        { _id: new ObjectId(id), userId: req.session.user._id },
        { $set: { title, description: updatedDescription } }
    );

    if (result.matchedCount > 0) return resp.redirect("/");
    resp.send("❌ You cannot update another user's task");
});

// ---------------------- SERVER ----------------------
const PORT = process.env.PORT || 3200;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
