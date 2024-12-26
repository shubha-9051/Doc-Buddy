const WebSocket = require("ws");
const express = require("express");
const axios = require("axios");
const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const { urlencoded } = require("body-parser");

const speech = require("@google-cloud/speech");
const speechClient = new speech.SpeechClient();

const TWILIO_RESPONSE_API = "https://d8c7-119-161-98-139.ngrok-free.app/process-query";

// Function to create a speech recognition request
const createRequest = (languageCode) => ({
  config: {
    encoding: "MULAW",
    sampleRateHertz: 8000,
    languageCode: languageCode,
  },
  interimResults: true,
});

let silenceTimeout;
const SILENCE_TIMEOUT_MS = 3000; // 3 seconds
const STREAMING_LIMIT = 290000; // 4 minutes 50 seconds

wss.on("connection", function connection(ws) {
  console.log("New Connection Initiated");

  let recognizeStream = null;
  let accumulatedTranscript = ""; // Variable to accumulate the final transcripts
  let languageCode = "en-US"; // Default language
  let streamingStartTime = Date.now();

  const startRecognitionStream = () => {
    streamingStartTime = Date.now();
    recognizeStream = speechClient
      .streamingRecognize(createRequest(languageCode))
      .on("error", (error) => {
        console.error("Recognition stream error:", error);
        if (error.code === 11) {
          restartRecognitionStream();
        }
      })
      .on("data", (data) => {
        if (data.results[0].isFinal) {
          const transcript = data.results[0].alternatives[0].transcript;
          console.log(`Transcript: ${transcript}`);

          // Accumulate the final transcript
          accumulatedTranscript += transcript + " ";

          // Reset the silence timeout
          resetSilenceTimeout();

          // Send final transcriptions to the clients
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  event: "final-transcription",
                  text: transcript,
                })
              );
            }
          });
        } else {
          const interimTranscript = data.results[0].alternatives[0].transcript;
          console.log(`Interim Transcript: ${interimTranscript}`);

          // Send interim transcriptions to the clients
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  event: "interim-transcription",
                  text: interimTranscript,
                })
              );
            }
          });
        }
      });
  };

  const restartRecognitionStream = () => {
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream.removeAllListeners();
    }
    startRecognitionStream();
  };

  const sendTranscriptToApi = async (transcript) => {
    if (!transcript.trim()) {
      console.log("Transcript is empty, not sending to API");
      return "Transcript is empty, cannot provide advice.";
    }

    const payload = { query: transcript };

    try {
      console.log("Sending transcript to API:", JSON.stringify(payload, null, 2));
      const response = await axios.post(TWILIO_RESPONSE_API, payload);
      return response.data.response;
    } catch (error) {
      console.error("Error sending transcript to API:", error);
      return "Sorry, we could not process your request at the moment.";
    }
  };

  const handleApiResponse = async (transcript) => {
    const apiResponse = await sendTranscriptToApi(transcript);

    // Save the response to a file named response.json
    saveResponseToFile(apiResponse);

    // Send the response back to Twilio to be spoken by calling /twilio-webhook
    await sendResponseToTwilio(apiResponse);

    // Optionally send the response back to WebSocket clients (for logging/debugging)
    ws.send(
      JSON.stringify({
        event: "response",
        text: apiResponse,
      })
    );
  };

  const saveTranscriptToFile = (transcript) => {
    const filePath = path.join(__dirname, 'transcript.json');
    const jsonContent = JSON.stringify({ query: transcript }, null, 2);
    fs.writeFile(filePath, jsonContent, (err) => {
      if (err) {
        console.error("Error writing transcript to file:", err);
      } else {
        console.log("Transcript saved to file:", filePath);
      }
    });
  };

  const saveResponseToFile = (response) => {
    const filePath = path.join(__dirname, 'response.json');
    const jsonContent = JSON.stringify({ response: response }, null, 2);
    fs.writeFile(filePath, jsonContent, (err) => {
      if (err) {
        console.error("Error writing response to file:", err);
      } else {
        console.log("Response saved to file:", filePath);
      }
    });
  };

  const resetSilenceTimeout = () => {
    if (silenceTimeout) clearTimeout(silenceTimeout);
    silenceTimeout = setTimeout(async () => {
      console.log("User is silent. Sending transcript to API...");
      await handleApiResponse(accumulatedTranscript.trim());
      saveTranscriptToFile(accumulatedTranscript.trim()); // Save transcript to file
      accumulatedTranscript = ""; // Clear after sending
    }, SILENCE_TIMEOUT_MS);
  };

  const checkStreamRestart = () => {
    if (Date.now() - streamingStartTime > STREAMING_LIMIT) {
      restartRecognitionStream();
    }
  };

  ws.on("message", function incoming(message) {
    const msg = JSON.parse(message);
    switch (msg.event) {
      case "connected":
        console.log("A new call has connected.");
        break;
      case "start":
        console.log(`Starting Media Stream ${msg.streamSid}`);
        startRecognitionStream();
        break;
      case "media":
        checkStreamRestart();
        // Write Media Packets to the recognize stream
        const audioChunk = Buffer.from(msg.media.payload, 'base64');
        if (recognizeStream) {
          recognizeStream.write(audioChunk);
        }
        break;
      case "stop":
        console.log("Call Has Ended");
        if (recognizeStream) {
          recognizeStream.end();
          recognizeStream = null;
        }
        if (accumulatedTranscript.trim()) {
          handleApiResponse(accumulatedTranscript.trim());
          saveTranscriptToFile(accumulatedTranscript.trim()); // Save transcript to file
        }
        accumulatedTranscript = ""; // Clear after sending
        break;
    }
  });

  ws.on("close", () => {
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream = null;
    }
    if (accumulatedTranscript.trim()) {
      handleApiResponse(accumulatedTranscript.trim());
      saveTranscriptToFile(accumulatedTranscript.trim()); // Save transcript to file
    }
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error: ${error}`);
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream = null;
    }
    if (accumulatedTranscript.trim()) {
      handleApiResponse(accumulatedTranscript.trim());
      saveTranscriptToFile(accumulatedTranscript.trim()); // Save transcript to file
    }
  });
});

app.use(express.static("public"));
app.use(urlencoded({ extended: false }));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "/index.html")));

app.post("/", (req, res) => {
  res.set("Content-Type", "text/xml");

  res.send(`
    <Response>
      <Start>
        <Stream url="wss://${req.headers.host}/"/>
      </Start>
      <Say>What is your health problem?</Say>
      <Pause length="60" />
    </Response>
  `);
});

// Async function to send response to Twilio
const sendResponseToTwilio = async (response) => {
  try {
    await axios.post('http://localhost:8080/twilio-webhook', { response });
  } catch (error) {
    console.error("Error sending response to Twilio:", error);
  }
};

// Route to handle Twilio WebSocket events and speak the response
app.post("/twilio-webhook", (req, res) => {
  res.set("Content-Type", "text/xml");
  const { response } = req.body;

  res.send(`
    <Response>
      <Say>${response}</Say>
    </Response>
  `);
});

console.log("Listening on Port 8080");
server.listen(8080);
