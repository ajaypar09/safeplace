exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured on server.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  const { food, restaurant } = body;

  if (!food) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Food item is required.' }) };
  }

  const itemLabel = restaurant ? `${food} from ${restaurant}` : food;

  const systemPrompt = `You are a celiac disease and gluten-free diet expert. Search the web for real ingredient and allergen information, then analyze it thoroughly. Check for obvious gluten sources (wheat, barley, rye), hidden sources (soy sauce, malt, modified food starch, wheat starch, brewer's yeast, natural flavors), and cross-contamination risks. Respond ONLY with a raw JSON object — no markdown, no backticks, no explanation.`;

  const userPrompt = `Analyze "${itemLabel}" for gluten-free and celiac safety. Search the web for official ingredients and allergen info. Return ONLY this JSON:
{"item":"${food}","restaurant":"${restaurant || 'Unknown'}","gluten_free":{"verdict":"safe|unsafe|caution|unknown","explanation":"1-2 sentences","flagged_ingredients":["list"]},"celiac_safe":{"verdict":"safe|unsafe|caution|unknown","explanation":"cross-contamination explanation","risks":["list"]},"all_ingredients":["full list if found"],"caution_ingredients":["hidden gluten risks"],"summary":"2-3 sentence recommendation for someone with celiac.","data_source":"source"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: err.error?.message || `Anthropic error ${response.status}` })
      };
    }

    const data = await response.json();

    let jsonText = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text') jsonText += block.text;
    }

    const clean = jsonText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('Could not parse response');
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Something went wrong.' })
    };
  }
};
