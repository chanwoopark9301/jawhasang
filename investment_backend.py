import time


def normalize_position(raw, symbol_re):
    position = dict(raw or {})
    symbol = str(position.get('symbol', '')).strip().upper()
    if not symbol_re.match(symbol):
        raise ValueError('유효하지 않은 종목 코드입니다')
    position['symbol'] = symbol
    position.setdefault('id', f'ip{int(time.time() * 1000)}')

    numeric_fields = [
        'shares', 'avgPrice', 'currentPrice', 'targetPrice',
        'stopPrice', 'previousClose', 'changePercent',
    ]
    nullable_fields = {'currentPrice', 'previousClose', 'changePercent'}
    for field in numeric_fields:
        if position.get(field) in (None, ''):
            position[field] = None if field in nullable_fields else 0
            continue
        try:
            position[field] = float(str(position[field]).replace(',', '').strip())
        except (TypeError, ValueError):
            position[field] = None if field in nullable_fields else 0
    return position


def upsert_position(data, raw_position, normalize_data, symbol_re):
    normalized_data = normalize_data(data)
    inv = normalized_data['investment']
    position = normalize_position(raw_position, symbol_re)
    positions = inv.get('positions', [])

    replaced = False
    for idx, item in enumerate(positions):
        same_id = str(item.get('id')) == str(position.get('id'))
        same_symbol = str(item.get('symbol', '')).upper() == position['symbol']
        if same_id or same_symbol:
            positions[idx] = {**item, **position}
            replaced = True
            break

    if not replaced:
        positions.append(position)

    inv['positions'] = positions
    normalized_data['investment'] = inv
    return normalized_data, inv, position
