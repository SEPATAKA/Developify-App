import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:developify_mobile/app/environment/app_environment.dart';
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/core/storage/token_storage.dart';
import 'package:developify_mobile/features/notifications/data/api_notification_repository.dart';
import 'package:developify_mobile/features/notifications/domain/notification_repository.dart';

class ChatAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final body = options.method == 'GET'
        ? '[{"id":"support-1","text":"We can help.","fromSupport":true,"createdAt":"2026-10-13T00:00:00.000Z"}]'
        : '{"id":"user-1","text":"Please help.","fromSupport":false,"createdAt":"2026-10-13T00:01:00.000Z"}';
    return ResponseBody.fromString(
      body,
      options.method == 'GET' ? 200 : 201,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  test('Chat loads support replies and sends authenticated messages', () async {
    final adapter = ChatAdapter();
    final dio = Dio()..httpClientAdapter = adapter;
    final tokens = MemoryTokenStorage();
    await tokens.writeToken('firebase-id-token');
    final client = ApiClient(
      environment: const AppEnvironment(
        apiBaseUrl: 'https://api.example.test',
        mockMode: false,
      ),
      tokens: tokens,
      dio: dio,
    );
    final repository = ApiNotificationRepository(client);

    final loaded = await repository.messages();
    expect(loaded, isA<Success<List<ChatMessage>>>());
    final supportReply = (loaded as Success<List<ChatMessage>>).value.single;
    expect(supportReply.outgoing, isFalse);
    expect(supportReply.text, 'We can help.');

    final sent = await repository.sendLocalMessage('Please help.');
    expect(sent, isA<Success<ChatMessage>>());
    final userMessage = (sent as Success<ChatMessage>).value;
    expect(userMessage.outgoing, isTrue);
    expect(userMessage.text, 'Please help.');
    expect(adapter.requests, hasLength(2));
    expect(
      adapter.requests.map((request) => request.path),
      everyElement('/v1/notifications/chat/messages'),
    );
    expect(
      adapter.requests.map((request) => request.headers['Authorization']),
      everyElement('Bearer firebase-id-token'),
    );
    expect(adapter.requests.last.data, {'text': 'Please help.'});
    client.dispose();
  });
}
