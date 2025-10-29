const express = require('express');
const mongoose = require('moongoose');
require('dotenv').config();

const app = express();

const PORT = 3001

if (!process.env.MONGODB_URI) {
    throw new Error('MongoDB connection required');
}
mongoose.connect(process.env.MONGODB_URI).then(() => {
    app.listen(PORT, () => {
        console.log(`Listening on port ${PORT}`);
    })

})


app.get('/', (req, res) =>
{
    res.send('Hello World!');
})




