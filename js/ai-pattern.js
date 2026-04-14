/* =============================================
   自畵像 — AI 전체 패턴 분석
   의존성: state.js, utils.js, data.js

   수정 (버그픽스):
   - runPatternAnalysis/runMyPatternAnalysis: try/finally로 loading 항상 초기화
   ============================================= */

// ---------------------------------------------------------------------------
// 상담 기록 전체 패턴 분석
// ---------------------------------------------------------------------------

async function runPatternAnalysis() {
  if (!state.selStudent || state.patternLoading) return;
  const student = state.students.find(s => s.id === state.selStudent);
  if (!student) return;

  const sessions = state.sessions
    .filter(s => s.studentId === state.selStudent)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sessions.length) { alert('분석할 회기가 없습니다.'); return; }

  state.patternLoading = true;
  renderAIPanel();

  const sessionsText = sessions.map(s =>
    `${s.sessionNum}회기 (${s.date}):\n${s.verbatim}` +
    (s.memo    ? `\n[메모] ${s.memo}`          : '') +
    (s.analysis ? `\n[슈퍼비전 요약] ${s.analysis.overall}` : '')
  ).join('\n\n---\n\n');

  const prompt = `당신은 학교상담 임상 슈퍼바이저입니다.
${student.alias} (${student.grade}) 내담자의 전체 ${sessions.length}회기 기록입니다.
가정: ${student.family || '정보 없음'} | 교우: ${student.peers || '정보 없음'} | 상황: ${student.situation || '정보 없음'}

${sessionsText}

위 전체 회기를 분석해 종합 패턴 보고서를 JSON으로 작성하세요.
각 항목은 핵심만 2-4문장으로 간결하게. JSON으로만 응답.

{
  "clientPattern":    "전체 회기에서 보이는 내담자 핵심 패턴 (방어기제, 반복 주제, 감정 흐름 변화)",
  "counselorPattern": "상담자의 반복 개입 패턴과 임상적 의미",
  "progress":         "회기 경과에 따른 변화와 진전 수준",
  "keyMoments":       "임상적으로 중요한 전환점 또는 주목할 장면",
  "nextFocus":        "향후 상담 핵심 과제와 방향",
  "overall":          "전체 사례 종합 임상 평가"
}`;

  try {
    const text = await streamAnalyze(
      { model: 'claude-sonnet-4-6', max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }] },
      (acc) => {
        const lbl = document.querySelector('#ai-content .ai-loading-label');
        if (lbl) lbl.textContent = `패턴 분석 중... ${acc.length}자`;
      }
    );
    const result   = parseJSON(text);
    result.savedAt = new Date().toISOString().split('T')[0];
    student.patternAnalysis = result;
    saveData();
    showPatternModal(result, false);
  } catch (e) {
    console.error('패턴 분석 오류:', e);
    alert('패턴 분석 오류:\n' + e.message);
  } finally {
    state.patternLoading = false;
  }
  renderAIPanel();
}

// ---------------------------------------------------------------------------
// 나의 기록 전체 패턴 분석
// ---------------------------------------------------------------------------

async function runMyPatternAnalysis() {
  if (!state.selTopic || state.myPatternLoading) return;
  const topic = state.myTopics.find(t => t.id === state.selTopic);
  if (!topic) return;

  const msgs = state.currentChatMessages.filter(m => m.role !== 'system');
  if (!msgs.length) {
    showToast('대화 내용이 없어요. 먼저 대화를 나눠보세요.');
    return;
  }

  state.myPatternLoading = true;
  renderAIPanel();

  const chatText = msgs.map(m =>
    `${m.role === 'user' ? '나' : 'AI'}: ${m.text}`
  ).join('\n\n');

  const aiRole = topic.aiPrompt || '따뜻하게 경청하고 성찰을 돕는 코치';
  const prompt = `당신은 ${aiRole} 역할입니다.
아래는 '${topic.title}' 주제로 나눈 오늘의 대화입니다.

${chatText}

위 대화를 바탕으로, '${topic.title}'에 어울리는 자연스러운 글로 정리해주세요.
규칙:
- 대화를 그대로 옮기지 말고 핵심 내용·감정·통찰을 녹인 글로 요약
- 1인칭으로 작성
- 마크다운 없이 순수 텍스트
- 너무 길지 않게 (300~500자 내외)`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('').trim();
    if (text) openModal('chat-summary', { text, topic });
  } catch (e) {
    showToast('요약 실패: ' + e.message);
  } finally {
    state.myPatternLoading = false;
    renderAIPanel();
  }
}

// ---------------------------------------------------------------------------
// 패턴 분석 모달
// ---------------------------------------------------------------------------

function showPatternModal(result, isMy) {
  const sections = isMy
    ? [
        { key: 'pattern',   label: '핵심 패턴',       cls: 'rpt-blue'   },
        { key: 'growth',    label: '성장과 변화',      cls: 'rpt-green'  },
        { key: 'recurring', label: '반복되는 주제',    cls: 'rpt-amber'  },
        { key: 'insight',   label: '핵심 통찰',        cls: 'rpt-purple' },
        { key: 'nextFocus', label: '앞으로의 방향',    cls: 'rpt-red'    },
        { key: 'overall',   label: '종합 평가',        cls: 'rpt-purple' },
      ]
    : [
        { key: 'clientPattern',    label: '내담자 핵심 패턴', cls: 'rpt-blue'   },
        { key: 'counselorPattern', label: '상담자 개입 패턴', cls: 'rpt-amber'  },
        { key: 'progress',         label: '진전과 변화',      cls: 'rpt-green'  },
        { key: 'keyMoments',       label: '핵심 전환점',      cls: 'rpt-purple' },
        { key: 'nextFocus',        label: '다음 과제',        cls: 'rpt-red'    },
        { key: 'overall',          label: '종합 임상 평가',   cls: 'rpt-purple' },
      ];

  const accentColor = isMy ? '#1D9E75' : '#0F6E56';
  const sectionsHTML = sections.map(s => `
    <div class="rpt-section ${s.cls}">
      <div class="rpt-label" onclick="this.closest('.rpt-section').classList.toggle('rpt-collapsed')">
        <span>${s.label}</span><span class="rpt-chevron">▾</span>
      </div>
      <div class="rpt-body">${(result[s.key] || '—').replace(/\n/g, '<br>').replace(/ (\d+)\)/g, '<br>$1)')}</div>
    </div>`).join('');

  const overlay = document.getElementById('pattern-modal-overlay');
  const modal   = document.getElementById('pattern-modal');
  if (!overlay || !modal) return;

  modal.innerHTML = `
    <div class="popup-header" style="padding:14px 18px;">
      <span style="font-weight:600;color:${accentColor};">전체 패턴 분석 · ${esc(result.savedAt || '')}</span>
      <button class="popup-close-btn" onclick="closePatternModal()">×</button>
    </div>
    <div class="pattern-modal-body">${sectionsHTML}</div>`;

  overlay.style.display = '';
  modal.style.display   = '';
}

function closePatternModal() {
  const overlay = document.getElementById('pattern-modal-overlay');
  const modal   = document.getElementById('pattern-modal');
  if (overlay) overlay.style.display = 'none';
  if (modal)   modal.style.display   = 'none';
}

function viewLastPatternAnalysis() {
  const session  = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
  const student  = session
    ? state.students.find(s => s.id === session.studentId)
    : (state.selStudent ? state.students.find(s => s.id === state.selStudent) : null);
  if (student?.patternAnalysis) showPatternModal(student.patternAnalysis, false);
}

function viewLastMyPatternAnalysis() {
  const topic = state.selTopic ? state.myTopics.find(t => t.id === state.selTopic) : null;
  if (topic?.patternAnalysis) showPatternModal(topic.patternAnalysis, true);
}
