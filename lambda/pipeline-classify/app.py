"""Pipeline step: classify document content type using OpenAI."""
import json
import os
import boto3

dynamodb = boto3.resource('dynamodb')
cache_table = dynamodb.Table(os.environ.get('CACHE_TABLE', 'CoachingTool-Cache'))

VALID_TYPES = [
    'case_study', 'transcript', 'blog_post', 'journal_article',
    'report', 'guide', 'policy_brief', 'lecture', 'tool_or_resource', 'other',
]


def get_openai_client():
    import openai
    secrets_client = boto3.client('secretsmanager')
    secret = json.loads(
        secrets_client.get_secret_value(SecretId='coaching-tool/openai-api-key')['SecretString']
    )
    return openai.OpenAI(api_key=secret['OPENAI_API_KEY'])


def handler(event, context):
    """Classify a document's content type. Uses DynamoDB cache."""
    document_id = event.get('document_id', '')
    name = event.get('name', '')
    source = event.get('source', '')
    content = event.get('content', '')

    # Check cache first
    try:
        cached = cache_table.get_item(Key={'PK': f'CLASSIFY#{document_id}', 'SK': 'V1'})
        if 'Item' in cached:
            print(f'Cache hit for {document_id}')
            return {**event, 'content_type': cached['Item']['value']}
    except Exception as e:
        print(f'Cache lookup failed: {e}')

    # Classify via OpenAI
    excerpt = content[:2000] if content else ''
    prompt = f"Document name: {name}\nSource: {source}\n\nContent excerpt:\n{excerpt}"

    try:
        client = get_openai_client()
        resp = client.chat.completions.create(
            model='gpt-4.1-mini',
            messages=[
                {'role': 'system', 'content': 'Classify this document into one of these content types: case_study, transcript, blog_post, journal_article, report, guide, policy_brief, lecture, tool_or_resource, other. Return JSON: {"content_type": "...", "summary": "..."}'},
                {'role': 'user', 'content': prompt},
            ],
            temperature=0,
        )

        raw = resp.choices[0].message.content.strip()
        parsed = json.loads(raw.replace('```json', '').replace('```', '').strip())
        content_type = parsed.get('content_type', 'other')

        if content_type not in VALID_TYPES:
            content_type = 'other'

        # Cache result
        import time
        cache_table.put_item(Item={
            'PK': f'CLASSIFY#{document_id}',
            'SK': 'V1',
            'value': content_type,
            'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'ttl': int(time.time()) + 90 * 86400,
        })

        print(f'Classified {document_id} as {content_type}')
        return {**event, 'content_type': content_type}

    except Exception as e:
        print(f'Classification failed: {e}')
        return {**event, 'content_type': event.get('content_type', 'other')}
