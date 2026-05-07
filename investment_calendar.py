"""Investment calendar and analyst-context synchronization.

This module turns external market calendars into the app's existing
``investment.events`` timeline. It is read-only: no trading action is taken.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import csv
import io
import os
import re

import requests


ALPHA_VANTAGE_URL = 'https://www.alphavantage.co/query'
TRADING_ECONOMICS_URL = 'https://api.tradingeconomics.com/calendar/country/united%20states'
FMP_STABLE_URL = 'https://financialmodelingprep.com/stable'

MACRO_KEYWORDS = (
    'fomc', 'fed interest rate decision', 'federal funds rate',
    'cpi', 'consumer price index', 'inflation rate',
    'non farm payrolls', 'nonfarm payrolls', 'unemployment rate',
    'initial jobless claims', 'jobless claims',
)


def _today():
    return datetime.now(timezone.utc).date()


def _iso_date(value):
    text = str(value or '').strip()
    if not text:
        return ''
    if 'T' in text:
        text = text.split('T', 1)[0]
    if '/' in text:
        for fmt in ('%m/%d/%Y %I:%M:%S %p', '%m/%d/%Y %H:%M:%S', '%m/%d/%Y'):
            try:
                return datetime.strptime(text, fmt).date().isoformat()
            except ValueError:
                pass
    return text[:10]


def _num(value):
    if value in (None, ''):
        return None
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def _symbols(investment):
    return sorted({
        str(p.get('symbol') or '').strip().upper()
        for p in investment.get('positions') or []
        if str(p.get('assetType') or 'stock').lower() != 'cash' and p.get('symbol')
    })


def _event_id(prefix, *parts):
    raw = '-'.join(str(p or '').strip().lower() for p in parts)
    slug = re.sub(r'[^a-z0-9]+', '-', raw).strip('-')[:120]
    return f'{prefix}-{slug}'


def _merge_events(existing, incoming):
    by_id = {str(e.get('id')): dict(e) for e in existing or [] if e.get('id')}
    for event in incoming:
        if not event.get('id') or not event.get('date'):
            continue
        prior = by_id.get(str(event['id']), {})
        by_id[str(event['id'])] = {**prior, **event}
    return sorted(by_id.values(), key=lambda e: (str(e.get('date') or ''), str(e.get('title') or '')))


def fetch_earnings_events(symbols, days=90):
    api_key = os.getenv('ALPHA_VANTAGE_API_KEY', '').strip()
    if not api_key:
        return [], ['ALPHA_VANTAGE_API_KEY']

    cutoff = _today() + timedelta(days=days)
    events = []
    for symbol in symbols:
        resp = requests.get(
            ALPHA_VANTAGE_URL,
            params={
                'function': 'EARNINGS_CALENDAR',
                'symbol': symbol,
                'horizon': '3month',
                'apikey': api_key,
            },
            timeout=12,
        )
        if not resp.ok:
            continue
        rows = csv.DictReader(io.StringIO(resp.text))
        for row in rows:
            date = _iso_date(row.get('reportDate'))
            if not date:
                continue
            day = datetime.fromisoformat(date).date()
            if day > cutoff:
                continue
            estimate = row.get('estimate') or ''
            events.append({
                'id': _event_id('earnings', symbol, date),
                'date': date,
                'type': 'earnings',
                'severity': 'watch',
                'symbol': symbol,
                'title': f'{symbol} 실적 발표',
                'body': f"Alpha Vantage earnings calendar 기준. EPS 컨센서스: {estimate or '미제공'}. 발표 전 비중/손절/추가매수 금지 원칙 점검 필요.",
                'source': 'alpha-vantage-earnings-calendar',
                'estimate': estimate,
                'currency': row.get('currency') or '',
                'fiscalDateEnding': row.get('fiscalDateEnding') or '',
            })
    return events, []


def fetch_macro_events(days=45):
    api_key = os.getenv('TRADING_ECONOMICS_API_KEY', 'guest:guest').strip()
    if not api_key:
        return [], ['TRADING_ECONOMICS_API_KEY']

    start = _today().isoformat()
    end = (_today() + timedelta(days=days)).isoformat()
    resp = requests.get(
        f'{TRADING_ECONOMICS_URL}/{start}/{end}',
        params={'c': api_key, 'importance': '3'},
        timeout=12,
    )
    if not resp.ok:
        return [], []
    items = resp.json() if resp.content else []
    events = []
    for item in items if isinstance(items, list) else []:
        event_name = str(item.get('Event') or item.get('Category') or '').strip()
        category = str(item.get('Category') or '').strip()
        haystack = f'{event_name} {category}'.lower()
        if not any(k in haystack for k in MACRO_KEYWORDS):
            continue
        date = _iso_date(item.get('Date'))
        if not date:
            continue
        forecast = item.get('Forecast') or item.get('TEForecast') or ''
        previous = item.get('Previous') or ''
        events.append({
            'id': _event_id('macro', event_name, date),
            'date': date,
            'type': 'macro',
            'severity': 'watch',
            'symbol': 'MACRO',
            'title': event_name or category,
            'body': f"미국 주요 경제일정. 이전치: {previous or '미제공'} / 컨센서스: {forecast or '미제공'}. 성장주·비트코인·고밸류 종목 변동성 확대 가능성을 점검.",
            'source': 'trading-economics-calendar',
            'category': category,
            'previous': previous,
            'forecast': forecast,
            'sourceUrl': item.get('SourceURL') or item.get('URL') or '',
        })
    return events, []


def fetch_analyst_events(symbols):
    api_key = os.getenv('FMP_API_KEY', '').strip()
    if not api_key:
        return [], ['FMP_API_KEY']

    today = _today().isoformat()
    events = []
    for symbol in symbols:
        try:
            estimates = requests.get(
                f'{FMP_STABLE_URL}/analyst-estimates',
                params={'symbol': symbol, 'period': 'quarter', 'limit': 4, 'apikey': api_key},
                timeout=12,
            )
            if estimates.ok:
                data = estimates.json() if estimates.content else []
                first = data[0] if isinstance(data, list) and data else {}
                revenue = first.get('estimatedRevenueAvg') or first.get('revenueAvg')
                eps = first.get('estimatedEpsAvg') or first.get('epsAvg')
                if first:
                    events.append({
                        'id': _event_id('analyst-estimate', symbol, first.get('date') or today),
                        'date': today,
                        'type': 'analyst',
                        'severity': 'info',
                        'symbol': symbol,
                        'title': f'{symbol} 애널리스트 실적 컨센서스',
                        'body': f"FMP analyst estimates 기준. 예상 매출: {revenue or '미제공'} / 예상 EPS: {eps or '미제공'}. 컨센서스 변화 시 실적 전 계획 재점검.",
                        'source': 'fmp-analyst-estimates',
                        'estimateDate': first.get('date') or '',
                        'estimatedRevenueAvg': revenue,
                        'estimatedEpsAvg': eps,
                    })
        except Exception:
            continue
        try:
            targets = requests.get(
                f'{FMP_STABLE_URL}/price-target-consensus',
                params={'symbol': symbol, 'apikey': api_key},
                timeout=12,
            )
            if targets.ok:
                data = targets.json() if targets.content else []
                first = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else {})
                target = first.get('targetConsensus') or first.get('priceTargetAverage') or first.get('target')
                if _num(target) is not None:
                    events.append({
                        'id': _event_id('analyst-target', symbol, today),
                        'date': today,
                        'type': 'analyst',
                        'severity': 'info',
                        'symbol': symbol,
                        'title': f'{symbol} 목표주가 컨센서스',
                        'body': f"FMP price target consensus 기준. 목표주가 컨센서스: {target}. 목표가 변화는 매수 근거가 아니라 기존 투자 논리 점검 신호로 사용.",
                        'source': 'fmp-price-target-consensus',
                        'targetConsensus': target,
                    })
        except Exception:
            continue
    return events, []


def sync_investment_calendar(investment, days=45):
    inv = dict(investment or {})
    symbols = _symbols(inv)
    events = []
    missing = []

    earnings, miss = fetch_earnings_events(symbols, days=max(days, 90))
    events.extend(earnings)
    missing.extend(miss)

    macro, miss = fetch_macro_events(days=days)
    events.extend(macro)
    missing.extend(miss)

    analyst, miss = fetch_analyst_events(symbols)
    events.extend(analyst)
    missing.extend(miss)

    inv['events'] = _merge_events(inv.get('events') or [], events)
    inv['calendar'] = {
        **(inv.get('calendar') if isinstance(inv.get('calendar'), dict) else {}),
        'lastSyncedAt': datetime.now(timezone.utc).isoformat(),
        'lookaheadDays': days,
        'symbols': symbols,
        'missingProviders': sorted(set(missing)),
        'eventsSynced': len(events),
    }
    return {
        'ok': True,
        'investment': inv,
        'eventsSynced': len(events),
        'missingProviders': sorted(set(missing)),
    }
