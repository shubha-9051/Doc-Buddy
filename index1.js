import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import Groq from 'groq-sdk';

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse request bodies
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// In-memory storage for conversations
const conversations = {};

// Transcribe endpoint
app.post('/transcribe', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const callSid = req.body.CallSid; // Use CallSid as a unique identifier for the call
    let convo = conversations[callSid] || [];

    if (convo.length === 0) {
        twiml.say({
            voice: 'Polly.Joanna-Neural'
        }, 'Hey!');
        convo.push({ role: 'system', content: 'Joanna: Hey!' });
    }

    conversations[callSid] = convo;

    twiml.gather({
        enhanced: "true",
        speechTimeout: 'auto',
        speechModel: "phone_call",
        input: 'speech',
        action: `/respond?callSid=${callSid}`,
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

// Respond endpoint
app.post('/respond', async (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const callSid = req.body.CallSid; // Use CallSid as a unique identifier for the call
    let convo = conversations[callSid] || [];
    let voiceInput = req.body.SpeechResult;

    convo.push({ role: 'user', content: `You: ${voiceInput}` });
    let aiResponse = await getGroqChatCompletion(convo);
    convo.push({ role: 'system', content: aiResponse });

    conversations[callSid] = convo;

    twiml.say({
        voice: 'Polly.Joanna-Neural'
    }, aiResponse);

    twiml.redirect({
        method: 'POST'
    }, `/transcribe?callSid=${callSid}`);

    res.type('text/xml');
    res.send(twiml.toString());
});

const getGroqChatCompletion = async (convo) => {
    const groq = new Groq({ apiKey: "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" });

    const apiResponse = await groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: "you are an ai doctor and you only respond to medical queries. you give brief to the point answer. If anything beside medical queries is asked simply reply sorry i cant help.you also give if asked list of doctors from bangalore"
            },
            ...convo
        ],
        model: "llama3-8b-8192",
    });

    if (apiResponse.choices[0].text === '') {
        return 'Sorry, I could not get a response from the AI.';
    } else {
        return apiResponse.choices[0]?.message?.content;
    }
};

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
