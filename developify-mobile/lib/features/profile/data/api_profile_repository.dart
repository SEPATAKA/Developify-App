import 'dart:async';

import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/core/services/session_service.dart';
import 'package:developify_mobile/core/services/transaction_authorization.dart';
import 'package:developify_mobile/core/storage/api_document_uploader.dart';
import 'package:developify_mobile/core/storage/picked_local_file.dart';
import 'package:developify_mobile/features/profile/domain/profile_repository.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';

final class ApiProfileRepository implements ProfileRepository {
  ApiProfileRepository(
    this._client,
    this._session, {
    required this._authorization,
    DocumentUploader? uploader,
  }) : _uploader = uploader ?? ApiDocumentUploader(_client);

  final ApiClient _client;
  final SessionService _session;
  final TransactionAuthorization _authorization;
  final DocumentUploader _uploader;
  final _securityChanges = StreamController<SecurityPreferences>.broadcast();
  SecurityPreferences _security = const SecurityPreferences();
  ProfilePreferences _preferences = const ProfilePreferences();
  PayoutAccount? _payout;

  @override
  void dispose() {
    _securityChanges.close();
  }

  @override
  Future<Result<String>> uploadFile(
    PickedLocalFile file, {
    required String prefix,
  }) => _uploader.upload(file, prefix: prefix);

  @override
  Future<Result<void>> deleteFile(String storageKey) =>
      _uploader.delete(storageKey);

  @override
  void clearSession() {
    _security = const SecurityPreferences();
    _preferences = const ProfilePreferences();
    _payout = null;
  }

  @override
  Stream<SecurityPreferences> get securityChanges => _securityChanges.stream;

  @override
  SecurityPreferences get securityPreferences => _security;

  @override
  Future<Result<void>> saveSecurityPreferences(
    SecurityPreferences value,
  ) async {
    final result = await _client.request(
      path: '/v1/users/me/security',
      method: 'POST',
      data: {
        'action': 'savePreferences',
        'biometrics': value.biometrics,
        'twoFactorEnabled': value.twoFactorEnabled,
        'previousDevices': value.previousDevices,
      },
      decode: (_) {},
    );
    if (result.isSuccess) {
      _security = value;
      _securityChanges.add(value);
    }
    return result;
  }

  AppUser _mapUser(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    return AppUser(
      id: map['id'] as String? ?? _session.user?.id ?? '',
      name: map['name'] as String? ?? '',
      email: map['email'] as String? ?? '',
      phone: map['phone'] as String? ?? '',
      address: map['address'] as String? ?? '',
      entity: EntityType.values.firstWhere(
        (e) => e.name == map['entity'],
        orElse: () => EntityType.individual,
      ),
      hasProfilePhoto: map['hasProfilePhoto'] as bool? ?? false,
      profilePhotoKey: map['profilePhotoKey'] as String?,
      profilePhotoUrl: map['profilePhotoUrl'] as String?,
      countryCode: map['countryCode'] as String? ?? 'ZA',
      nonResident: map['nonResident'] as bool? ?? false,
    );
  }

  @override
  Future<Result<AppUser>> load() async {
    final userFuture = _client.request<AppUser>(
      path: '/v1/users/me',
      decode: _mapUser,
    );
    final preferencesFuture = _client.request<Object?>(
      path: '/v1/users/me/preferences',
      decode: (json) => json,
    );
    final payoutFuture = _client.request<Object?>(
      path: '/v1/users/me/payout',
      decode: (json) => json,
    );
    final securityFuture = _client.request<Object?>(
      path: '/v1/users/me/security',
      decode: (json) => json,
    );
    final user = await userFuture;
    if (user case Failure(:final error)) return Failure(error);
    final preferencesResult = await preferencesFuture;
    if (preferencesResult case Failure(:final error)) return Failure(error);
    final payoutResult = await payoutFuture;
    if (payoutResult case Failure(:final error)) return Failure(error);
    final securityResult = await securityFuture;
    if (securityResult case Failure(:final error)) return Failure(error);

    final preferences =
        (preferencesResult as Success<Object?>).value
            as Map<String, Object?>? ??
        const {};
    final defaults = const ProfilePreferences();
    _preferences = ProfilePreferences(
      channels: {...defaults.channels, ..._boolMap(preferences['channels'])},
      topics: {...defaults.topics, ..._boolMap(preferences['topics'])},
      language: preferences['language'] as String? ?? defaults.language,
    );

    final payout =
        (payoutResult as Success<Object?>).value as Map<String, Object?>?;
    _payout = payout == null
        ? null
        : PayoutAccount(
            bank: payout['bank'] as String? ?? '',
            number: payout['number'] as String? ?? '',
            type: payout['type'] as String? ?? '',
            branchCode: payout['branchCode'] as String? ?? '',
            holder: payout['holder'] as String? ?? '',
            proofKey: payout['proofKey'] as String?,
          );

    final security =
        (securityResult as Success<Object?>).value as Map<String, Object?>? ??
        const {};
    _security = SecurityPreferences(
      biometrics: {
        ...const SecurityPreferences().biometrics,
        ..._boolMap(security['biometrics']),
      },
      twoFactorEnabled: security['twoFactorEnabled'] as bool? ?? false,
      previousDevices:
          (security['previousDevices'] as List<dynamic>?)
              ?.whereType<String>()
              .toList() ??
          const [],
    );
    _securityChanges.add(_security);
    return user;
  }

  Map<String, bool> _boolMap(Object? value) => value is Map
      ? {
          for (final entry in value.entries)
            if (entry.key is String && entry.value is bool)
              entry.key as String: entry.value as bool,
        }
      : const {};

  @override
  Future<Result<AppUser>> update(AppUser user) {
    return _client.request(
      path: '/v1/users/me',
      method: 'PATCH',
      data: {
        'name': user.name,
        'email': user.email,
        'phone': user.phone,
        'address': user.address,
        'countryCode': user.countryCode,
        'hasProfilePhoto': user.hasProfilePhoto,
        if (user.profilePhotoKey != null)
          'profilePhotoKey': user.profilePhotoKey,
        'nonResident': user.nonResident,
      },
      decode: _mapUser,
    );
  }

  @override
  Future<Result<AppUser>> updateProfilePhoto(String storageKey) =>
      _client.request(
        path: '/v1/users/me',
        method: 'PATCH',
        data: {'profilePhotoKey': storageKey},
        decode: _mapUser,
      );

  @override
  PayoutAccount? get payoutAccount => _payout;

  @override
  ProfilePreferences get preferences => _preferences;

  @override
  Future<Result<void>> updatePreferences(ProfilePreferences preferences) async {
    final result = await _client.request(
      path: '/v1/users/me/preferences',
      method: 'PATCH',
      data: {
        'channels': preferences.channels,
        'topics': preferences.topics,
        'language': preferences.language,
      },
      decode: (_) {},
    );
    if (result.isSuccess) _preferences = preferences;
    return result;
  }

  @override
  Future<Result<void>> updatePayout(PayoutAccount account) async {
    final result = await _client.request(
      path: '/v1/users/me/payout',
      method: 'PATCH',
      data: {
        'bank': account.bank,
        'number': account.number,
        'type': account.type,
        'branchCode': account.branchCode,
        'holder': account.holder,
        'proofKey': account.proofKey,
      },
      decode: (_) {},
    );
    if (result.isSuccess) _payout = account;
    return result;
  }

  @override
  Future<Result<void>> updateSecurity(String action, {String? pin}) async {
    final result = await _client.request(
      path: '/v1/users/me/security',
      method: 'POST',
      data: {'action': action, 'pin': pin},
      decode: (_) {},
    );
    if (result.isSuccess && action == 'setPin' && pin != null) {
      _authorization.setPin(pin);
    }
    return result;
  }
}
