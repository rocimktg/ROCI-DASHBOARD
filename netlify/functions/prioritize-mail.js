const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

  let mailItems;
  try {
    ({ mailItems } = JSON.parse(event.body));
    if (!Array.isArray(mailItems) || mailItems.length === 0) throw new Error('no mail items provided');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request: ' + e.message }) };
  }

  const today = new Date().toISOString().slice(0, 10);

  const itemsText = mailItems.map((item, i) => {
    const d = item.details || {};
    return [
      `--- Item ${i + 1} ---`,
      `ID: ${item.id}`,
      `Sender/Vendor: ${item.vendor || 'Unknown'}`,
      `Summary: ${item.summary || 'N/A'}`,
      `Category: ${item.category || 'N/A'}`,
      `Current Priority: ${item.priority || 'N/A'}`,
      `Current Status: ${item.status || 'N/A'}`,
      `Amount Due: ${item.amount != null ? '$' + Number(item.amount).toFixed(2) : 'N/A'}`,
      `Due Date: ${item.due_date || 'N/A'}`,
      `Past Due: ${d.is_past_due ? 'YES' : 'No'}`,
      `Recurring: ${item.is_recurring ? 'Yes' : 'No'}`,
      `Late Fees: ${d.late_fees > 0 ? '$' + Number(d.late_fees).toFixed(2) : 'None'}`,
      `Billing Period: ${d.billing_period || 'N/A'}`,
    ].join('\n');
  }).join('\n\n');

  const prompt = `Today is ${today}. You are a financial assistant reviewing mail items for a business owner and helping them prioritize what needs immediate attention.

Here are all the non-archived mail items (${mailItems.length} total):

${itemsText}

PRIORITY RULES — apply in this order:

1. HIGH PRIORITY (red) — Act immediately:
   - Tax notices, IRS, state/local tax agencies, Texas Comptroller
   - Legal notices, court documents, compliance requirements
   - Creditors, collections, attorneys, debt collectors
   - Any notice with penalties, late fees, threats of service disruption, or legal action
   - Government payment notices
   - Past-due bills with late fees

2. MEDIUM PRIORITY (orange) — Act this week:
   - Regular utility bills (electric, water, gas, internet)
   - Insurance premiums
   - Subscriptions and vendor bills
   - Medical and hospital bills not yet past due
   - Credit card statements

3. LOW PRIORITY (yellow) — Act when convenient:
   - Recurring bills well before their due date
   - Non-urgent vendor communications
   - Upcoming renewals

4. INFORMATIONAL (purple) — No action required:
   - Statements explicitly showing zero balance
   - Explicit confirmations of a payment already made or marked complete/autopaid/done
   - General updates and notices without payment request
   - Policy documents without action required

5. ARCHIVE CANDIDATE (suggestions only — never auto-archive):
   - Junk mail and marketing materials
   - Duplicate notices already captured elsewhere
   - Already-handled informational mail that is confirmed complete

CRITICAL RULES:
- Never assume a bill is paid unless the item EXPLICITLY says it is paid, autopaid, complete, or done. If uncertain, mark it as needing review.
- When in doubt between two priority levels, always choose the higher one.
- Any item with a dollar amount and a due date should be at least Medium Priority unless confirmed paid.

Return ONLY valid JSON with this exact structure (no markdown, no code blocks):

{
  "title": "Mail Priority Report — ${today}",
  "summary": "2-3 sentence plain English summary of the most urgent items and overall status of this batch",
  "itemsScanned": ${mailItems.length},
  "highestPriorityItems": [
    {
      "id": "exact item id from the data above",
      "sender": "sender/vendor name",
      "recommendedPriority": "High Priority",
      "reason": "One sentence explaining why this priority level",
      "recommendedAction": "One sentence describing the specific next action"
    }
  ],
  "priorityUpdates": [
    {
      "id": "exact item id from the data above",
      "priority": "High Priority"
    }
  ],
  "archiveCandidates": [
    {
      "id": "exact item id from the data above",
      "reason": "One sentence explaining why this can be archived"
    }
  ],
  "fullReportText": "Complete readable plain-text report covering: (1) Executive summary, (2) All items listed by priority with reasoning and recommended action, (3) A section titled PROCESS IMPROVEMENT SUGGESTIONS that includes: new mail types encountered that do not fit current categories, suggested new categories or priority rules, data quality issues observed (missing amounts, unclear vendors, etc), workflow improvements, and anything that would make future prioritization scans more accurate.",
  "processImprovements": [
    "Specific improvement suggestion 1",
    "Specific improvement suggestion 2"
  ]
}

Rules for the JSON:
- highestPriorityItems: include all items, ordered from most urgent to least urgent
- priorityUpdates: include ALL ${mailItems.length} items — one entry per item
- archiveCandidates: only genuine archive candidates; leave empty array if none
- priority values must be exactly one of: "High Priority", "Medium Priority", "Low Priority", "Informational"`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Claude API error: ' + errText }) };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';

    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
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
