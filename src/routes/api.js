const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const twilio = require('twilio');
const FraudReport = require('../models/FraudReport');
const DashboardABI = require('../abis/DashboardFacet.json');
const { analyzeFraudReport } = require('../utils/ai');
const axios = require('axios');

// Helper function to get the base URL
const getBaseUrl = () => {
  // For production (Render)
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    return process.env.BASE_URL || 'https://grainllyvoiceagent.onrender.com';
  }
  
  // For development with LocalTunnel
  if (process.env.DYNAMIC_BASE_URL) {
    return process.env.DYNAMIC_BASE_URL;
  }
  
  // Fallback for local development
  return 'https://grainllyvoiceagent.onrender.com';
};

// Helper to log Twilio params
const logTwilioParams = (action, params) => {
  console.log(`🔍 Twilio ${action} params:`, {
    url: params.url,
    to: params.to,
    from: params.from,
    baseUrl: getBaseUrl()
  });
};

// Initialize Twilio client
const getTwilioClient = () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials not configured');
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
};

// Initialize blockchain provider - no top-level await
let diamondContract;
try {
  const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_AMOY_RPC);
  diamondContract = new ethers.Contract(
    process.env.DIAMOND_CONTRACT_ADDRESS,
    DashboardABI,
    provider
  );
} catch (error) {
  console.error('Failed to initialize blockchain provider:', error);
}

// Simple voice welcome endpoint
router.post('/voice', (req, res) => {
  console.log('📞 Incoming call received');
  console.log('Request body:', req.body);
  
  // Create a TwiML response
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Add a welcome message
  twiml.say('Welcome to the Ration Distribution System.');
  
  // Add a gather for language selection
  twiml.gather({
    numDigits: 1,
    action: `${getBaseUrl()}/api/language`,
    method: 'POST'
  }).say('For English, press 1. For Hindi, press 2.');
  
  // Send the response
  console.log('TwiML Response:', twiml.toString());
  res.type('text/xml');
  res.send(twiml.toString());
});

// Language selection handler
router.post('/language', (req, res) => {
  console.log('🌐 Language selection received');
  console.log('Request body:', req.body);
  
  const digits = req.body.Digits || '1';
  const callSid = req.body.CallSid;
  
  // Save language to database
  const language = digits === '2' ? 'hi-IN' : 'en-US';
  if (callSid) {
    FraudReport.findOneAndUpdate(
      { callSid },
      { language }
    ).catch(err => console.error('❌ Failed to update language:', err));
  }
  
  // Create TwiML response
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Add instructions based on selected language
  if (language === 'hi-IN') {
    twiml.say('Kripya apni shikayat darj karne ke liye beep ke baad boliye.');
  } else {
    twiml.say('Please record your complaint after the beep.');
  }
  
  // Add recording instruction with transcription enabled
  twiml.record({
    action: `${getBaseUrl()}/api/recording-complete`,
    maxLength: 60,
    playBeep: true,
    transcribe: true,
    transcribeCallback: `${getBaseUrl()}/api/transcription-callback`
  });
  
  // Send the response
  console.log('TwiML Response:', twiml.toString());
  res.type('text/xml');
  res.send(twiml.toString());
});

// Recording completion handler
router.post('/recording-complete', (req, res) => {
  console.log('🎙️ Recording complete');
  console.log('Request body:', req.body);
  
  const callSid = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;
  
  // Update database with recording URL only
  if (recordingUrl && callSid) {
    FraudReport.findOneAndUpdate(
      { callSid },
      { 
        recordingUrl,
        callStatus: 'completed',
        completedAt: new Date()
      }
    ).catch(err => console.error('❌ Error updating recording:', err));
  }
  
  // Create TwiML response
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Add thank you message
  twiml.say('Thank you for your report. We will take appropriate action. Goodbye.');
  
  // Add hangup
  twiml.hangup();
  
  // Send the response
  console.log('TwiML Response:', twiml.toString());
  res.type('text/xml');
  res.send(twiml.toString());
});

// Transcription callback handler - using promises instead of async/await
router.post('/transcription-callback', (req, res) => {
  console.log('📝 Transcription received');
  console.log('Request body:', req.body);
  
  const callSid = req.body.CallSid;
  const transcriptionText = req.body.TranscriptionText;
  
  // Update the report with the actual transcription
  if (callSid && transcriptionText) {
    FraudReport.findOne({ callSid })
      .then(report => {
        if (report) {
          return analyzeFraudReport(
            transcriptionText, 
            report.language || 'en-US'
          ).then(({ fraudSummary, fraudSeverity }) => {
            return FraudReport.findOneAndUpdate(
              { callSid },
              { 
                transcript: transcriptionText,
                fraudSummary,
                fraudSeverity
              }
            );
          });
        }
      })
      .then(() => {
        console.log('✅ Report updated with actual transcription');
      })
      .catch(error => {
        console.error('❌ Error processing transcription:', error);
      });
  }
  
  // Send a 200 OK response to Twilio
  res.status(200).send('OK');
});

// Make test call - using promises instead of async/await
router.post('/make-test-call', (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({ 
      success: false, 
      error: 'Phone number is required' 
    });
  }
  
  try {
    // Initialize Twilio client
    const client = getTwilioClient();
    
    // Format phone number
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    
    // Make the call - using the dynamic base URL
    const callParams = {
      url: `${getBaseUrl()}/api/voice`,
      to: formattedPhone,
      from: process.env.TWILIO_PHONE_NUMBER,
      statusCallback: `${getBaseUrl()}/api/call-status`,
      statusCallbackEvent: ['completed']
    };
    
    logTwilioParams('call', callParams);
    
    client.calls.create(callParams)
      .then(call => {
        const report = new FraudReport({
          aadhaar: '123456789012',
          name: 'Test User',
          mobile: formattedPhone,
          callSid: call.sid,
          callStatus: 'initiated'
        });
        
        return report.save().then(() => call);
      })
      .then(call => {
        res.json({
          success: true,
          message: 'Test call initiated',
          callSid: call.sid
        });
      })
      .catch(error => {
        console.error('❌ Error making test call:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to make call',
          details: error.message
        });
      });
  } catch (error) {
    console.error('❌ Error initializing call:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize call',
      details: error.message
    });
  }
});

// Call status webhook
router.post('/call-status', (req, res) => {
  const { CallSid, CallStatus } = req.body;
  
  console.log(`📞 Call status: ${CallStatus} for ${CallSid}`);
  
  // Update database
  FraudReport.findOneAndUpdate(
    { callSid: CallSid },
    { callStatus: CallStatus }
  ).catch(err => console.error('❌ Error updating call status:', err));
  
  res.status(200).send('OK');
});

// Main fraud report endpoint with blockchain - using promises instead of async/await
router.post('/report-fraud', (req, res) => {
  const { aadhaar } = req.body;
  
  if (!aadhaar) {
    return res.status(400).json({ 
      success: false, 
      error: 'Aadhaar number is required' 
    });
  }

  if (!diamondContract) {
    return res.status(500).json({
      success: false,
      error: 'Blockchain provider not initialized'
    });
  }

  diamondContract.getConsumerByAadhaar(aadhaar)
    .then(consumer => {
      const name = consumer.name;
      const mobile = consumer.mobile;
      
      if (!mobile || mobile.length < 10) {
        return res.status(400).json({ 
          success: false, 
          error: 'Valid mobile number not found for this Aadhaar' 
        });
      }

      // Format phone number
      const formattedMobile = mobile.startsWith('+91') ? mobile : `+91${mobile}`;
      
      // Make the call
      const client = getTwilioClient();
      return client.calls.create({
        url: `${getBaseUrl()}/api/voice`,
        to: formattedMobile,
        from: process.env.TWILIO_PHONE_NUMBER,
        statusCallback: `${getBaseUrl()}/api/call-status`,
        statusCallbackEvent: ['completed']
      }).then(call => {
        // Create report
        const report = new FraudReport({
          aadhaar: aadhaar.toString(),
          name,
          mobile: formattedMobile,
          callSid: call.sid,
          callStatus: 'initiated'
        });

        return report.save().then(() => {
          res.json({ 
            success: true,
            message: 'Call initiated successfully',
            callSid: call.sid,
            consumerName: name,
            reportId: report._id
          });
        });
      });
    })
    .catch(error => {
      console.error('❌ Error in report-fraud:', error);
      
      if (error.message && error.message.includes('Consumer not found')) {
        return res.status(404).json({ 
          success: false, 
          error: 'Consumer not found with this Aadhaar number' 
        });
      }
      
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error',
        details: error.message 
      });
    });
});

// Get all reports with playable recording URLs - using promises instead of async/await
router.get('/reports', (req, res) => {
  FraudReport.find()
    .sort({ createdAt: -1 })
    .then(reports => {
      // Add a playable URL for each recording
      const reportsWithPlayableUrl = reports.map(report => {
        const reportObj = report.toObject();
        
        if (reportObj.recordingUrl) {
          // Extract the recording SID from the URL
          const recordingSid = reportObj.recordingUrl.split('/').pop();
          reportObj.playableRecordingUrl = `${getBaseUrl()}/api/recording/${recordingSid}`;
        }
        
        return reportObj;
      });
      
      res.json({
        success: true,
        reports: reportsWithPlayableUrl
      });
    })
    .catch(error => {
      console.error('❌ Error fetching reports:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error fetching reports' 
      });
    });
});

// Stream recording from Twilio - using promises instead of async/await
router.get('/recording/:recordingSid', (req, res) => {
  const recordingSid = req.params.recordingSid;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  // Create authentication header for Twilio
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  
  // Construct the URL to the recording
  const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
  
  // Make a request to Twilio to get the recording
  axios({
    method: 'get',
    url: recordingUrl,
    responseType: 'stream',
    headers: {
      'Authorization': `Basic ${auth}`
    }
  })
  .then(response => {
    // Set appropriate headers for audio streaming
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.set('Access-Control-Allow-Origin', '*');  // Allow cross-origin requests
    
    // Pipe the audio stream to the response
    response.data.pipe(res);
  })
  .catch(error => {
    console.error('Error fetching recording:', error);
    res.status(500).send('Error fetching recording');
  });
});

// Serve the audio player page
router.get('/audio-player', (req, res) => {
  const recordingSid = req.query.sid;
  
  if (!recordingSid) {
    return res.status(400).send('Recording SID is required');
  }
  
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Complaint Recording</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
      }
      h1 {
        color: #3f51b5;
      }
      .audio-player {
        width: 100%;
        margin: 20px 0;
      }
      .transcript {
        background-color: #f5f5f5;
        padding: 15px;
        border-radius: 8px;
        margin-top: 20px;
      }
      .transcript h3 {
        margin-top: 0;
      }
    </style>
  </head>
  <body>
    <h1>Complaint Recording</h1>
    <div class="audio-player">
      <audio controls style="width: 100%">
        <source src="${getBaseUrl()}/api/recording/${recordingSid}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
    </div>
    <div id="transcript-container" class="transcript" style="display: none;">
      <h3>Transcript</h3>
      <p id="transcript-text"></p>
    </div>
    <script>
      // Fetch transcript for this recording
      const recordingSid = "${recordingSid}";
      
      fetch('${getBaseUrl()}/api/recording-details/' + recordingSid)
        .then(response => response.json())
        .then(data => {
          if (data.success && data.transcript) {
            document.getElementById('transcript-text').textContent = data.transcript;
            document.getElementById('transcript-container').style.display = 'block';
          }
        })
        .catch(error => console.error('Error fetching transcript:', error));
    </script>
  </body>
  </html>
  `;
  
  res.send(html);
});

// Get recording details including transcript - using promises instead of async/await
router.get('/recording-details/:recordingSid', (req, res) => {
  const recordingSid = req.params.recordingSid;
  
  // Find the report that contains this recording
  FraudReport.findOne({
    recordingUrl: { $regex: recordingSid }
  })
  .then(report => {
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Recording not found'
      });
    }
    
    res.json({
      success: true,
      transcript: report.transcript,
      fraudSummary: report.fraudSummary,
      fraudSeverity: report.fraudSeverity,
      language: report.language
    });
  })
  .catch(error => {
    console.error('Error fetching recording details:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching recording details'
    });
  });
});

// Debug route to check environment variables
router.get('/debug', (req, res) => {
  console.log('Debug route called');
  res.json({
    environment: process.env.NODE_ENV || 'not set',
    baseUrl: getBaseUrl(),
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ? 
      `${process.env.TWILIO_ACCOUNT_SID.substring(0, 4)}...` : 'not set',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ? 
      'is set (hidden)' : 'not set',
    twilioPhone: process.env.TWILIO_PHONE_NUMBER || 'not set'
  });
});

// Test Twilio credentials directly
router.get('/test-twilio', (req, res) => {
  try {
    console.log('Testing Twilio credentials...');
    console.log('Account SID:', process.env.TWILIO_ACCOUNT_SID?.substring(0, 4) + '...');
    
    const client = getTwilioClient();
    
    client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch()
      .then(account => {
        res.json({
          success: true,
          accountName: account.friendlyName,
          status: account.status
        });
      })
      .catch(error => {
        console.error('Twilio test error:', error);
        res.status(500).json({
          success: false,
          error: error.message,
          code: error.code,
          status: error.status
        });
      });
  } catch (error) {
    console.error('Twilio init error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;