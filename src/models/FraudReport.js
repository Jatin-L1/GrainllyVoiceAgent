const mongoose = require('mongoose');

const fraudReportSchema = new mongoose.Schema({
  aadhaar: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  mobile: {
    type: String,
    required: true
  },
  callSid: {
    type: String,
    required: true,
    unique: true
  },
  callStatus: {
    type: String,
    enum: ['initiated', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'canceled'],
    default: 'initiated'
  },
  language: {
    type: String,
    enum: ['en-US', 'hi-IN'],
    default: 'en-US'
  },
  recordingUrl: {
    type: String
  },
  transcript: {
    type: String
  },
  fraudSummary: {
    type: String
  },
  fraudSeverity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical', 'no-fraud'],
    default: 'medium'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
});

const FraudReport = mongoose.model('FraudReport', fraudReportSchema);

module.exports = FraudReport;