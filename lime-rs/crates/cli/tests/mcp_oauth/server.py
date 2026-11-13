#!/usr/bin/env python3
"""Explicit App Server protocol fixture; no network or credentials."""
import json
import os
from pathlib import Path
import sys

scenario = os.environ['LIME_MCP_CLI_TEST_SCENARIO']
log = Path(os.environ['LIME_MCP_CLI_TEST_LOG'])


def send(body):
    print(json.dumps({'jsonrpc': '2.0', **body}), flush=True)


def completed(**overrides):
    params = {'name': 'market:research', 'threadId': None, 'loginId': 'login-42',
              'success': True}
    params.update(overrides)
    send({'method': 'mcpServer/oauthLogin/completed', 'params': params})


for line in sys.stdin:
    request = json.loads(line)
    with log.open('a') as stream:
        stream.write(json.dumps(request) + '\n')
    method = request.get('method')
    if method == 'initialize':
        result = {
            'serverInfo': {'name': 'explicit-mcp-cli-fixture', 'version': '1.0.0',
                           'protocolVersion': os.environ['LIME_MCP_CLI_TEST_PROTOCOL']},
            'platform': {'family': 'unix', 'os': 'fixture'},
            'capabilities': {'agentSession': False, 'capabilityDiscovery': False,
                             'artifact': False, 'workspace': False},
        }
    elif method == 'initialized':
        continue
    elif method == 'mcpServer/oauth/login':
        assert request['params']['name'] == 'market:research'
        assert request['params']['scopes'] == ['research:read']
        result = {'authorizationUrl': 'https://mcp.example.invalid/authorize',
                  'state': 'fixture-state', 'loginId': 'login-42'}
        if scenario == 'success':
            # Completion can precede the response; the CLI must retain it.
            completed()
        elif scenario == 'failed':
            completed(success=False, error='untrusted-provider-token-do-not-print')
        elif scenario == 'unrelated':
            completed(name='another-server')
            completed(loginId='another-login')
            completed(threadId='another-thread')
            completed(success=False, error='untrusted-provider-token-do-not-print')
        elif scenario == 'missing_id':
            del result['loginId']
        elif scenario not in ('disconnected', 'pending'):
            raise AssertionError(scenario)
    elif method == 'mcpServer/list':
        # Market-installed MCPs are resolved by the owner, outside this list.
        result = {'servers': []}
    elif method == 'mcpServer/oauth/logout':
        assert request['params']['name'] == 'market:research'
        if scenario == 'logout_rejected':
            send({'id': request['id'], 'error': {'code': -32602,
                  'message': 'OAuth logout only supports streamable_http transport'}})
            continue
        result = {'removed': True}
    else:
        raise AssertionError(method)
    send({'id': request['id'], 'result': result})
    if scenario == 'disconnected' and method == 'mcpServer/oauth/login':
        break
