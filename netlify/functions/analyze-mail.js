const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = `Analyze this photo of physical mail or a bill. Return ONLY valid JSON — no markdown, no code blocks, no explanation:

{
  "vendor": "company or sender name",
  "amount": null or numeric dollar amount (number only, no dollar sign),
  "due_date": null or "YYYY-MM-DD",
  "is_recurring": true or false,
  "bill_type": "medical" or "hospital" or "regular" or "general",
  "summary": "one sentence description, under 20 words"
}

Rules:
- bill_type "medical": doctor, clinic, physician, pharmacy bills
- bill_type "hospital": hospital, ER, surgery, inpatient bills
- bill_type "regular": utilities, subscriptions, credit cards, phone, internet, insurance (typically recurring)
- bill_type "general": everything else — notices, statements, junk mail, letters
- is_recurring: true only if clearly a monthly/recurring charge
- Do NOT include account numbers, card numbers, routing numbers, or SSNs in any field
- amount must be a plain number like 42.50, not a string`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'CLAUDE_API_KEY not set' }) };
  }

  let imageBase64, mediaType;
  try {
    ({ imageBase64, mediaType } = JSON.parse(event.body));
    if (!imageBase64) throw new Error('missing imageBase64');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request: ' + e.message }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/jpeg',
                data: imageBase64,
              },
            },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Claude API error: ' + errText }) };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*?\}/);
    let parsed = {};
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch {}
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Server error: ' + e.message }),
    };
  }
};
