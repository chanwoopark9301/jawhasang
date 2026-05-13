"""Investment natural-language reasoning engine.

This module sits before the LLM. It reads the user's utterance against the
account ledger and turns loose language into a structured reasoning frame:
intent, ledger interpretation, autofill opportunities, ambiguity, and behavior
control. It does not call external APIs or mutate storage.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List

from investment_desk_engine import build_investment_desk_engine


def _num(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(str(value).replace(",", "").strip())
    except Exception:
        return default


def _today(value: Any = None) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value[:10]).date()
        except Exception:
            pass
    return date.today()


def _is_cash(position: Dict[str, Any]) -> bool:
    return (
        str(position.get("assetType") or "").lower() == "cash"
        or str(position.get("symbol") or "").upper() == "CASH"
    )


def _symbol(position: Dict[str, Any]) -> str:
    return str(position.get("symbol") or "").strip().upper()


def _position_value(position: Dict[str, Any]) -> float:
    if _is_cash(position):
        return _num(position.get("cashAmount"), _num(position.get("shares")))
    return _num(position.get("shares")) * _num(position.get("currentPrice"))


def _position_cost(position: Dict[str, Any]) -> float:
    if _is_cash(position):
        return _position_value(position)
    return _num(position.get("shares")) * _num(position.get("avgPrice"))


def _positions(investment: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [p for p in investment.get("positions") or [] if isinstance(p, dict)]


def _tradable_positions(investment: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [p for p in _positions(investment) if _symbol(p) and not _is_cash(p)]


def _cash_position(investment: Dict[str, Any]) -> Dict[str, Any] | None:
    return next((p for p in _positions(investment) if _is_cash(p)), None)


def _portfolio_context(investment: Dict[str, Any]) -> Dict[str, Any]:
    positions = _positions(investment)
    total = sum(_position_value(p) for p in positions)
    holdings = []
    for p in positions:
        value = _position_value(p)
        cost = _position_cost(p)
        holdings.append({
            "symbol": _symbol(p),
            "name": p.get("name") or _symbol(p),
            "assetType": str(p.get("assetType") or "stock").lower(),
            "shares": _num(p.get("shares")),
            "avgPrice": _num(p.get("avgPrice")),
            "currentPrice": _num(p.get("currentPrice")),
            "value": value,
            "gainPercent": ((value - cost) / cost * 100.0) if cost else 0.0,
            "weight": (value / total * 100.0) if total else 0.0,
        })
    return {
        "totalValue": total,
        "cashValue": _position_value(_cash_position(investment) or {}),
        "holdings": holdings,
    }


_ALIASES = {
    "INTC": [r"\bINTC\b", r"\bintel\b", "인텔"],
    "IREN": [r"\bIREN\b", "아이렌", r"iris\s+energy"],
    "CRCL": [r"\bCRCL\b", "써클", "서클", r"\bcircle\b"],
    "ETH-USD": [r"\bETH(?:-USD)?\b", "이더리움", r"\bethereum\b", r"\bether\b"],
    "BTC-USD": [r"\bBTC(?:-USD)?\b", "비트코인", r"\bbitcoin\b"],
    "QLD": [r"\bQLD\b"],
    "QQQM": [r"\bQQQM\b"],
}


def _mentioned_symbols(text: str, investment: Dict[str, Any]) -> List[str]:
    raw = text or ""
    symbols: List[str] = []
    for symbol, patterns in _ALIASES.items():
        if any(re.search(pattern, raw, re.I) for pattern in patterns):
            symbols.append(symbol)
    for p in _tradable_positions(investment):
        symbol = _symbol(p)
        if symbol and symbol not in symbols and re.search(rf"\b{re.escape(symbol)}\b", raw, re.I):
            symbols.append(symbol)
    return symbols


def _intent_type(text: str) -> str:
    raw = text or ""
    lower = raw.lower()
    if re.search(r"브리핑|시황|오늘\s*중요|시장\s*상황|brief|market", raw, re.I):
        return "briefing"
    if re.search(r"원칙|손절\s*조건|추가매수\s*조건|비중\s*기준|규칙|rule|thesis|invalidation", raw, re.I):
        return "rule_design"
    if re.search(r"사도|살까|매수|추매|팔까|매도|손절|익절|buy|sell|add|trim", raw, re.I):
        return "trade_decision"
    if re.search(r"포트폴리오|계좌|보유|몇\s*주|평단|나머지|남은\s*(?:돈|주식)|현금|예수금|바꿨|바꾸|portfolio|position|account", raw, re.I):
        return "portfolio_update"
    if re.search(r"뉴스|공시|검색|찾아|동향|일정|실적|cpi|fomc|news|filing|earnings", lower, re.I):
        return "research"
    return "conversation"


def _amount_krw(text: str) -> float:
    raw = (text or "").replace(",", "")
    total = 0.0
    for regex, mult in [
        (r"([0-9]+(?:\.[0-9]+)?)\s*억", 100_000_000),
        (r"([0-9]+(?:\.[0-9]+)?)\s*천", 10_000_000 if "억" in raw else 1_000),
        (r"([0-9]+(?:\.[0-9]+)?)\s*백", 1_000_000 if "억" in raw else 100),
        (r"([0-9]+(?:\.[0-9]+)?)\s*만", 10_000),
    ]:
        m = re.search(regex, raw)
        if m:
            total += _num(m.group(1)) * mult
    if total:
        return total
    m = re.search(r"([0-9][0-9.]*)\s*(?:원|KRW)", raw, re.I)
    return _num(m.group(1)) if m else 0.0


def _loss_percent(text: str) -> float:
    raw = text or ""
    patterns = [
        r"([0-9][0-9,.]*)\s*(?:%|프로|퍼센트|percent)[^\n.。]{0,24}(?:마이너스|손실|손해|하락|minus|down|loss)",
        r"(?:마이너스|손실|손해|하락|minus|down|loss)[^\n.。]{0,24}([0-9][0-9,.]*)\s*(?:%|프로|퍼센트|percent)",
        r"-([0-9][0-9,.]*)\s*(?:%|프로|퍼센트|percent)",
    ]
    for pattern in patterns:
        m = re.search(pattern, raw, re.I)
        if m:
            return _num(m.group(1))
    return 0.0


def _fact_status(text: str, symbol: str) -> str:
    clause = _symbol_clause(text, symbol)
    if re.search(r"그대로|유지|변경\s*없|남아|보유\s*중|unchanged|keep|remain", clause, re.I):
        return "keep"
    if re.search(r"없|정리|팔|매도|청산|0|전부|이제\s*없|sold|remove|closed", clause, re.I):
        return "remove_or_zero"
    if re.search(r"샀|매수|투입|넣었|진입|바꿨|바꾸|전부|bought|buy|invested|converted", clause, re.I):
        return "new_or_increase"
    return "mentioned"


def _symbol_clause(text: str, symbol: str) -> str:
    raw = text or ""
    hits = []
    for sym, patterns in _ALIASES.items():
        for pattern in patterns:
            m = re.search(pattern, raw, re.I)
            if m:
                hits.append((m.start(), sym))
                break
    hits.sort()
    for idx, (start, sym) in enumerate(hits):
        if sym != symbol:
            continue
        end = hits[idx + 1][0] if idx + 1 < len(hits) else len(raw)
        return raw[start:end]
    return raw


def _portfolio_interpretation(text: str, investment: Dict[str, Any], mentioned: List[str]) -> Dict[str, Any]:
    existing = {_symbol(p): p for p in _tradable_positions(investment)}
    cash = _cash_position(investment)
    unchanged = []
    remove = []
    new_or_increase = []
    ambiguous = []
    for symbol in mentioned:
        status = _fact_status(text, symbol)
        if status == "keep":
            unchanged.append(symbol)
        elif status == "remove_or_zero":
            remove.append(symbol)
        elif status == "new_or_increase":
            new_or_increase.append(symbol)
        else:
            ambiguous.append(symbol)

    missing = []
    for symbol in new_or_increase:
        clause = _symbol_clause(text, symbol)
        if not re.search(r"([0-9][0-9,.]*)\s*(?:주|개|shares?|qty)", clause, re.I):
            if not (_amount_krw(clause) and _loss_percent(clause)):
                missing.append(f"{symbol} quantity or enough data to estimate it")
        if not re.search(r"(?:평단|평균\s*단가|avg|average|체결가|price)[^0-9]{0,24}[0-9]", clause, re.I):
            if not (_amount_krw(clause) and _loss_percent(clause)):
                missing.append(f"{symbol} average price or estimation basis")

    autofill = []
    if mentioned and _amount_krw(text) and _loss_percent(text):
        autofill.append({
            "type": "estimated_purchase",
            "symbols": new_or_increase or mentioned,
            "inputs": {
                "krwAmount": _amount_krw(text),
                "lossPercent": _loss_percent(text),
            },
            "needs": ["current quote", "USD/KRW"],
            "formula": "avgPrice = currentPrice / (1 - lossPercent); shares = (KRW / USDKRW) / avgPrice",
        })

    residual_candidates: List[str] = []
    residual_phrase = re.search(r"나머지|남은\s*(?:돈|주식|자금)|전부|everything\s+else|rest", text or "", re.I)
    if residual_phrase and new_or_increase:
        protected = set(unchanged + new_or_increase)
        residual_candidates = [
            symbol for symbol in sorted(existing.keys())
            if symbol and symbol not in protected
        ]
        if cash and _position_value(cash) > 0:
            residual_candidates.insert(0, "CASH")
        if residual_candidates:
            missing.append(f"Confirm whether residual phrase includes {', '.join(residual_candidates)}")

    return {
        "existingSymbols": sorted(existing.keys()),
        "unchanged": unchanged,
        "removeOrZero": remove,
        "newOrIncrease": new_or_increase,
        "residualCandidates": residual_candidates,
        "ambiguousSymbols": ambiguous,
        "missingFields": missing,
        "autofill": autofill,
        "confirmationRequired": bool(missing or ambiguous or residual_candidates),
    }


def _research_frame(intent: str, symbols: List[str], investment: Dict[str, Any], desk: Dict[str, Any]) -> Dict[str, Any]:
    theses = {str(t.get("symbol") or "").upper(): t for t in desk.get("theses") or [] if isinstance(t, dict)}
    scenario = {str(s.get("symbol") or "").upper(): s for s in desk.get("scenarios") or [] if isinstance(s, dict)}
    agenda = []
    target_symbols = symbols or [p["symbol"] for p in _portfolio_context(investment)["holdings"] if p["symbol"] and p["symbol"] != "CASH"]
    for symbol in target_symbols[:5]:
        thesis = theses.get(symbol, {})
        agenda.append({
            "symbol": symbol,
            "drivers": thesis.get("drivers") or [],
            "openQuestions": thesis.get("openQuestions") or [],
            "scenarioActions": {
                "bull": scenario.get(symbol, {}).get("bullCase", {}).get("action"),
                "base": scenario.get(symbol, {}).get("baseCase", {}).get("action"),
                "bear": scenario.get(symbol, {}).get("bearCase", {}).get("action"),
            },
            "neededEvidence": _needed_evidence_for(symbol, thesis),
        })
    macro = [
        "market regime and target cash range",
        "rates/Fed/CPI liquidity pressure",
        "sector breadth and momentum exhaustion",
        "near-term earnings, policy, and geopolitical events",
    ]
    if intent == "briefing":
        macro.insert(0, "what is already priced in versus not confirmed")
    return {"macro": macro, "symbols": agenda}


def _needed_evidence_for(symbol: str, thesis: Dict[str, Any]) -> List[str]:
    profile = thesis.get("profile") or ""
    if profile == "stablecoin_issuer":
        return ["USDC supply trend", "Fed path / reserve yield", "official bill text or committee schedule"]
    if profile == "crypto_beta":
        return ["crypto spot trend", "ETF/flow confirmation", "policy and dollar/rate signals"]
    if profile == "ai_miner_infrastructure":
        return ["contract acceptance/RPO/ARR", "funding or dilution filings", "BTC/hash economics"]
    if profile == "growth_index_semiconductor":
        return ["Nasdaq breadth", "AI capex trend", "rates and valuation pressure"]
    return ["official filings", "earnings/guidance", "sector and valuation context"]


def _decision_protocol(intent: str, text: str, symbols: List[str], desk: Dict[str, Any]) -> Dict[str, Any]:
    if intent != "trade_decision":
        return {
            "requiresGate": False,
            "evidenceToCheck": [],
            "doNotDo": [],
            "nextStep": "none",
        }
    thesis_map = {str(t.get("symbol") or "").upper(): t for t in desk.get("theses") or [] if isinstance(t, dict)}
    controls = {str(c.get("symbol") or "").upper(): c for c in desk.get("behaviorControls") or [] if isinstance(c, dict)}
    target = symbols[0] if symbols else ""
    thesis = thesis_map.get(target, {})
    control = controls.get(target, {})
    evidence = _needed_evidence_for(target, thesis)
    do_not_do = []
    raw = text or ""
    if re.search(r"루머|rumor|x\.com|twitter|트윗|signal", raw, re.I):
        do_not_do.append("Do not buy or add on rumor/X flow before official confirmation.")
    do_not_do.extend(control.get("blockedActions") or [])
    do_not_do.extend(control.get("doNotDo") or [])
    if not do_not_do:
        do_not_do.append("Do not act before checking size, thesis, invalidation, and cooldown.")
    return {
        "requiresGate": True,
        "symbol": target,
        "evidenceToCheck": evidence,
        "doNotDo": do_not_do[:6],
        "nextStep": "run_trade_gate_before_llm_advice",
    }


def _rule_draft(intent: str, text: str, symbols: List[str], desk: Dict[str, Any]) -> Dict[str, Any] | None:
    if intent != "rule_design":
        return None
    thesis_map = {str(t.get("symbol") or "").upper(): t for t in desk.get("theses") or [] if isinstance(t, dict)}
    symbol = symbols[0] if symbols else ""
    thesis = thesis_map.get(symbol, {})
    evidence = _needed_evidence_for(symbol, thesis)
    drivers = thesis.get("drivers") or []
    return {
        "symbol": symbol,
        "drivers": drivers,
        "evidenceHierarchy": evidence,
        "template": (
            f"{symbol or 'POSITION'} rule: If [invalidation condition] is confirmed by "
            f"[evidence], then [action]. Exception only if [counter-evidence] appears before execution."
        ),
        "decisionNeeded": [
            "Which driver invalidates the thesis first?",
            "What action follows confirmation: reduce, stop adding, hedge, or exit?",
            "What official evidence overrides rumor or price noise?",
        ],
    }


def _foresight_agenda(intent: str, symbols: List[str], investment: Dict[str, Any], desk: Dict[str, Any]) -> List[Dict[str, Any]]:
    if intent not in {"briefing", "trade_decision", "rule_design", "research"}:
        return []
    rows = {row["symbol"]: row for row in _portfolio_context(investment)["holdings"]}
    thesis_map = {str(t.get("symbol") or "").upper(): t for t in desk.get("theses") or [] if isinstance(t, dict)}
    targets = symbols or [row["symbol"] for row in _portfolio_context(investment)["holdings"] if row["symbol"] and row["symbol"] != "CASH"]
    agenda = []
    for symbol in targets[:5]:
        row = rows.get(symbol, {})
        thesis = thesis_map.get(symbol, {})
        evidence = _needed_evidence_for(symbol, thesis)
        agenda.append({
            "symbol": symbol,
            "priority": _priority_from_weight(row.get("weight", 0.0)),
            "whyItMatters": _why_symbol_matters(symbol, thesis),
            "watch": evidence[:3],
            "riskIfWrong": "position sizing and timing error" if row else "watchlist view may be premature",
        })
    return agenda


def _priority_from_weight(weight: float) -> str:
    if weight >= 25:
        return "critical"
    if weight >= 10:
        return "high"
    if weight > 0:
        return "medium"
    return "watch"


def _why_symbol_matters(symbol: str, thesis: Dict[str, Any]) -> str:
    profile = thesis.get("profile") or ""
    if profile == "stablecoin_issuer":
        return "Stablecoin supply, reserve yield, and legislation can move the stock more than headline EPS."
    if profile == "crypto_beta":
        return "Crypto liquidity and policy can lead risk appetite across related holdings."
    if profile == "ai_miner_infrastructure":
        return "AI contract execution, funding, and BTC economics decide whether the story is real."
    if profile == "growth_index_semiconductor":
        return "Market regime and breadth matter more than the narrative after a strong rally."
    return f"{symbol} needs evidence that the original thesis still explains the price."


def _action_for(intent: str, interpretation: Dict[str, Any], text: str) -> str:
    if intent == "portfolio_update":
        if interpretation.get("autofill") and not interpretation.get("missingFields"):
            return "autofill_then_estimated_write"
        return "ask_missing_before_write"
    if intent == "trade_decision":
        return "run_trade_gate_before_ai"
    if intent == "briefing":
        return "build_desk_briefing"
    if intent == "rule_design":
        return "draft_rule_with_invalidation_questions"
    if intent == "research":
        return "collect_evidence_before_view"
    return "respond_concisely"


def build_investment_reasoning(text: str, investment: Dict[str, Any], today: Any = None) -> Dict[str, Any]:
    inv = investment or {}
    day = _today(today)
    intent = _intent_type(text or "")
    mentioned = _mentioned_symbols(text or "", inv)
    desk = build_investment_desk_engine(inv, day)
    interpretation = _portfolio_interpretation(text or "", inv, mentioned) if intent == "portfolio_update" else {}
    research = _research_frame(intent, mentioned, inv, desk)
    decision_protocol = _decision_protocol(intent, text or "", mentioned, desk)
    rule_draft = _rule_draft(intent, text or "", mentioned, desk)
    foresight = _foresight_agenda(intent, mentioned, inv, desk)
    action = _action_for(intent, interpretation, text or "")
    controls = [
        item for item in desk.get("behaviorControls") or []
        if not mentioned or item.get("symbol") in mentioned
    ]
    questions = []
    if interpretation.get("missingFields"):
        questions.extend(interpretation["missingFields"])
    if intent == "rule_design":
        questions.extend(_rule_questions(text or "", mentioned, desk))
    if intent == "briefing":
        questions.append("No user question needed unless a trade action is requested; prepare a briefing from ledger, regime, events, and evidence.")

    return {
        "intentType": intent,
        "action": action,
        "confidence": _confidence(intent, mentioned, interpretation),
        "mentionedSymbols": mentioned,
        "ledgerContext": _portfolio_context(inv),
        "interpretation": interpretation,
        "researchFrame": research,
        "decisionProtocol": decision_protocol,
        "ruleDraft": rule_draft,
        "foresightAgenda": foresight,
        "behaviorControls": controls,
        "questions": questions[:5],
        "llmInstructions": _llm_instructions(intent, action),
    }


def _rule_questions(text: str, symbols: List[str], desk: Dict[str, Any]) -> List[str]:
    questions = []
    thesis = {str(t.get("symbol") or "").upper(): t for t in desk.get("theses") or [] if isinstance(t, dict)}
    for symbol in symbols[:2]:
        drivers = thesis.get(symbol, {}).get("drivers") or []
        if drivers:
            questions.append(f"{symbol}: choose which driver invalidates the thesis first ({', '.join(drivers[:3])}).")
        questions.append(f"{symbol}: define action if the invalidation condition is confirmed.")
    if not questions:
        questions.append("Choose the symbol or exposure this rule should control.")
    return questions


def _confidence(intent: str, symbols: List[str], interpretation: Dict[str, Any]) -> str:
    if intent in {"briefing", "research"}:
        return "medium"
    if symbols and not interpretation.get("ambiguousSymbols"):
        return "high"
    if symbols:
        return "medium"
    return "low"


def _llm_instructions(intent: str, action: str) -> List[str]:
    base = [
        "Use the reasoning engine output before answering.",
        "Do not mutate ledger facts unless the engine action explicitly allows a write path.",
        "Ask only for fields that remain ambiguous after ledger/context lookup.",
    ]
    if intent == "briefing":
        base.append("Brief from portfolio exposure, market regime, evidence quality, and do-not-do actions; do not repeat a full account table.")
    if intent == "rule_design":
        base.append("Draft a rule with invalidation conditions, evidence required, action, and exception conditions.")
    if intent == "trade_decision":
        base.append("Run or respect the Trade Gate before giving any buy/sell view; separate rumor from official evidence.")
    if action == "autofill_then_estimated_write":
        base.append("Mark calculated holdings as estimated until broker-confirmed fills replace them.")
    return base
