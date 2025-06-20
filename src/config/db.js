const mongoose = require('mongoose');

const connectDB = () => {
  return mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
      console.log('MongoDB connected successfully');
    })
    .catch((error) => {
      console.error('MongoDB connection error:', error.message);
      process.exit(1);
    });
};

module.exports = connectDB;