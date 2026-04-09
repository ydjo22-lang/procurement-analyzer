export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company, job, jd, dartData } = req.body;
  if (!company) return res.status(400).json({ error: '기업명이 필요합니다' });

  const dartStatus =
    (dartData?.sections_found_count >= 3) ? 'DART 기반 분석' :
    (dartData?.sections_found_count >= 1) ? '부분 DART 기반 분석' : '제한적 분석';

  const systemPrompt = `You are a procurement-focused corporate analyst for Korean job seekers in their 20s-30s.
Return ONLY a raw JSON object. No markdown, no code fences, no explanation whatsoever.
CRITICAL: All string values must be on a single line. Never use actual newlines inside string values. Use a space instead.
CRITICAL: Never use unescaped double quotes inside string values.

JSON structure:
{
  "company": "기업명",
  "report_info": "보고서명 (공시일)",
  "dart_status": "${dartStatus}",
  "summary": ["요약1","요약2","요약3","요약4","요약5"],
  "trends": [{"badge":"배지","badge_type":"teal|blue|purple|amber","title":"제목","body":"설명 2문장"}],
  "risks": [{"badge":"배지","badge_type":"red|amber","title":"제목","body":"설명 2문장"}],
  "procurement_relevance": [{"badge":"직결|연관","badge_type":"purple|blue","title":"제목","body":"설명 2문장"}],
  "for_newbies": [{"title":"제목","body":"설명 2문장"}],
  "manager_concerns": [{"title":"제목","body":"설명 2문장"}],
  "jd_connection": [{"title":"업무명","body":"설명 2문장"}],
  "interview_keywords": ["키워드1","키워드2","키워드3","키워드4","키워드5","키워드6","키워드7","키워드8"]
}

Counts: trends 3, risks 3, procurement_relevance 3, for_newbies 3, manager_concerns 4, jd_connection 3, keywords 8.
All text in Korean. Use specific numbers and names from DART data.`;

  const userMsg = `기업명: ${company}
지원직무: ${job}
JD: ${jd || '(없음)'}
DART 보고서: ${dartData?.report_nm || '없음'} (${dartData?.rcept_dt || '미확인'})
섹션: ${dartData?.sections_found_count || 0}개 추출
내용: ${JSON.stringify(dartData?.sections || {})}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: 'Anthropic API 오류', detail: err });
    }

    const data = await response.json();
    const raw = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const analysis = safeParseJson(raw);
    if (!analysis) {
      return res.status(500).json({ error: 'JSON 파싱 실패. 다시 시도해주세요.' });
    }
    return res.status(200).json(analysis);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function safeParseJson(text) {
  // 1) 코드 펜스 제거
  let s = text.replace(/```json|```/g, '').trim();

  // 2) JSON 블록 추출 (중괄호 기준)
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);

  // 3) 제어문자 제거 (탭·줄바꿈 제외)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 4) 문자열 내부 줄바꿈 → 공백
  s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) =>
    `"${inner.replace(/\n/g, ' ').replace(/\r/g, '')}"`
  );

  // 5) 파싱 시도
  try { return JSON.parse(s); } catch (_) {}

  // 6) 잘린 경우 복구 시도
  try {
    const fixed = s.replace(/,\s*[\]}][^}\]]*$/, '') + ']}';
    return JSON.parse(fixed);
  } catch (_) {}

  return null;
}
