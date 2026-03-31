"""Pipeline step: generate case study metadata using OpenAI."""
import json
import os
import time
import boto3

dynamodb = boto3.resource('dynamodb')
cache_table = dynamodb.Table(os.environ.get('CACHE_TABLE', 'CoachingTool-Cache'))


def get_openai_client():
    import openai
    secrets_client = boto3.client('secretsmanager')
    secret = json.loads(
        secrets_client.get_secret_value(SecretId='coaching-tool/openai-api-key')['SecretString']
    )
    return openai.OpenAI(api_key=secret['OPENAI_API_KEY'])


SUMMARY_PROMPT = """Analyze this case study and return a JSON object with:
{
  "title": "short title",
  "summary": "2-3 sentence summary",
  "location": "geographic location or 'Not specified'",
  "timeframe": "time period or 'Not specified'",
  "demographic": "target demographic or 'Not specified'",
  "scale": "small|medium|large",
  "tags": ["tag1", "tag2", ...],
  "key_outcomes": ["outcome1", "outcome2", ...],
  "implementation_steps": ["step1", "step2", ...]
}"""


def handler(event, context):
    """Generate LLM metadata for a case study. Uses DynamoDB cache."""
    document_id = event.get('document_id', '')
    name = event.get('name', '')
    content = event.get('content', '')

    # Check cache
    try:
        cached = cache_table.get_item(Key={'PK': f'SUMMARY#{document_id}', 'SK': 'V1'})
        if 'Item' in cached:
            print(f'Cache hit for summary {document_id}')
            return {**event, 'metadata': json.loads(cached['Item']['value'])}
    except Exception as e:
        print(f'Summary cache lookup failed: {e}')

    # Generate via OpenAI
    excerpt = content[:6000] if content else ''
    user_msg = f"Case Study: {name}\n\n{excerpt}"

    try:
        client = get_openai_client()
        resp = client.chat.completions.create(
            model='gpt-4.1-mini',
            messages=[
                {'role': 'system', 'content': SUMMARY_PROMPT},
                {'role': 'user', 'content': user_msg},
            ],
            temperature=0,
        )

        raw = resp.choices[0].message.content.strip()
        metadata = json.loads(raw.replace('```json', '').replace('```', '').strip())

        # Cache result
        cache_table.put_item(Item={
            'PK': f'SUMMARY#{document_id}',
            'SK': 'V1',
            'value': json.dumps(metadata),
            'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'ttl': int(time.time()) + 90 * 86400,
        })

        print(f'Generated metadata for {document_id}: {metadata.get("title", "?")}')
        return {**event, 'metadata': metadata}

    except Exception as e:
        print(f'Metadata generation failed: {e}')
        return {**event, 'metadata': {'title': name, 'summary': '', 'tags': [], 'scale': 'medium'}}
