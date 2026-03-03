import express from 'express';

const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());

app.get('/', (req, res) => {
    res.send('AI Language Tutor Backend is running');
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
