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

  const systemPrompt = `You are a procurement-focused corporate analyst for Korean job seekers in their 20s-30s targeting purchasing/procurement roles.
Analyze the provided DART filing data and return ONLY a valid JSON object. No markdown, no code blocks, no explanation. Raw JSON only.

Required JSON structure:
{
  "company": "기업명",
  "report_info": "보고서명 (공시일)",
  "dart_status": "${dartStatus}",
  "summary": ["두괄식 핵심 요약 1","2","3","4","5"],
  "trends": [{"badge":"배지텍스트","badge_type":"teal|blue|purple|amber","title":"제목","body":"2-3문장 설명"}],
  "risks": [{"badge":"배지텍스트","badge_type":"red|amber","title":"제목","body":"2-3문장 설명"}],
  "procurement_relevance": [{"badge":"직결|연관","badge_type":"purple|blue","title":"제목","body":"구매직무 관점 2-3문장"}],
  "for_newbies": [{"title":"제목","body":"신입 실무 지식 설명"}],
  "manager_concerns": [{"title":"제목","body":"팀장 실제 고민 내용"}],
  "jd_connection": [{"title":"업무명","body":"JD 기반 실제 수행 업무 설명"}],
  "interview_keywords": ["키워드1","키워드2","키워드3","키워드4","키워드5","키워드6","키워드7","키워드8"]
}

Item counts: trends 3-4, risks 3-4, procurement_relevance 3-4, for_newbies 3-4, manager_concerns 4-5, jd_connection 3-5, interview_keywords 8-10.
All text must be in Korean. Use specific numbers, company names, product names from DART data. Focus on procurement perspective throughout.`;

  const userMsg = `기업명: ${company}
지원직무: ${job}
JD: ${jd || '(없음)'}

DART 보고서: ${dartData?.report_nm || '없음'} (공시일: ${dartData?.rcept_dt || '미확인'})
섹션 추출: ${dartData?.sections_found_count || 0}/${dartData?.sections_requested_count || 6}개

섹션 내용:
${JSON.stringify(dartData?.sections || {}, null, 2)}`;

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
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: 'Anthropic API 오류', detail: err });
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(clean);
    return res.status(200).json(analysis);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
