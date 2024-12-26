// Download the helper library from https://www.twilio.com/docs/node/install
import twilio from 'twilio';

// Find your Account SID and Auth Token at twilio.com/console
// and set the environment variables. See http://twil.io/secure
const accountSid = "AC0f4ed8dccf5d0474847631156e720a6e";
const authToken = "d53583442f73599e4c9cf61de93145b8";
const client = twilio(accountSid, authToken);

client.calls.create({
  from: "+17203364882",
  to: "+919123721048",
  url: "https://82d6-119-161-98-139.ngrok-free.app/transcribe",
}).then(call => {
  console.log(call.sid);
}).catch(error => {
  console.error(error);
});
