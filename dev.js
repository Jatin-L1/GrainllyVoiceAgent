const { exec } = require('child_process');
require('dotenv').config();

// Store the actual port that will be used
let actualPort = process.env.PORT || 5000;

// Function to get a free port
const findFreePort = () => {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try the next one
        actualPort++; // Increment before trying again
        resolve(findFreePort());
      } else {
        reject(err);
      }
    });
    
    server.once('listening', () => {
      // Found a free port
      const port = server.address().port;
      server.close(() => {
        resolve(port);
      });
    });
    
    server.listen(actualPort);
  });
};

// Function to update Twilio webhook automatically
const updateTwilioWebhook = (url) => {
  try {
    const twilioClient = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    // Get all phone numbers
    twilioClient.incomingPhoneNumbers.list()
      .then(numbers => {
        // Find the number that matches your TWILIO_PHONE_NUMBER
        const phoneNumber = numbers.find(
          n => n.phoneNumber === process.env.TWILIO_PHONE_NUMBER
        );
        
        if (!phoneNumber) {
          console.error('❌ Could not find your Twilio phone number');
          return;
        }
        
        // Update the webhook URL
        return twilioClient.incomingPhoneNumbers(phoneNumber.sid)
          .update({
            voiceUrl: `${url}/api/voice`
          });
      })
      .then(() => {
        console.log('✅ Twilio webhook automatically updated to:');
        console.log(`📞 ${url}/api/voice`);
      })
      .catch(error => {
        console.error('❌ Failed to update Twilio webhook:', error);
        console.error('Please update it manually in the Twilio console');
      });
  } catch (error) {
    console.error('❌ Error initializing Twilio client:', error);
  }
};

// First find a free port, then start localtunnel
findFreePort().then(port => {
  actualPort = port;
  console.log(`🔍 Found free port: ${actualPort}`);
  console.log('🚀 Starting LocalTunnel...');
  
  // Use exec instead of spawn for better Windows compatibility
  const tunnel = exec(`npx localtunnel --port ${actualPort}`);
  
  tunnel.stdout.on('data', (data) => {
    // Extract the URL from LocalTunnel output
    if (data.includes('your url is:')) {
      const url = data.split('your url is: ')[1].trim();
      console.log(`\n🌐 LocalTunnel URL: ${url}`);
      
      // Set environment variables
      process.env.DYNAMIC_BASE_URL = url;
      process.env.PORT = actualPort;
      
      // Automatically update Twilio webhook
      updateTwilioWebhook(url);
      
      // Start the server with the dynamic URL
      console.log('📡 Starting server with dynamic URL...');
      require('./server.js');
    } else {
      console.log(data);
    }
  });
  
  tunnel.stderr.on('data', (data) => {
    console.error(`❌ LocalTunnel error: ${data}`);
  });
  
  // Handle application shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    tunnel.kill();
    process.exit(0);
  });
}).catch(err => {
  console.error('Error finding free port:', err);
});