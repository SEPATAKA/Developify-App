import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/core/storage/token_storage.dart';
import 'package:developify_mobile/core/utils/cancellation.dart';
import 'package:developify_mobile/features/authentication/domain/auth_repository.dart';
import 'package:developify_mobile/features/authentication/domain/investor_registration.dart';
import 'package:developify_mobile/features/authentication/domain/landowner_registration.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final class ApiAuthRepository implements AuthRepository {
  ApiAuthRepository(this._client, this._tokens, {required this.supabase}) {
    _authStateChanges = supabase.auth.onAuthStateChange.listen((state) {
      if (state.event == AuthChangeEvent.passwordRecovery) {
        _passwordRecoveryPending = true;
        _recoveryEmail = state.session?.user.email ?? _recoveryEmail;
      }
    });
  }

  static const _investorChallenge = 'supabase-investor-registration';
  static String get _authCallback => kIsWeb
      ? Uri.base.resolve('/auth-callback/').toString()
      : 'developify://auth-callback/';

  final ApiClient _client;
  final TokenStorage _tokens;
  final SupabaseClient supabase;
  late final StreamSubscription<AuthState> _authStateChanges;
  String? _recoveryEmail;
  bool _passwordRecoveryPending = false;
  InvestorRegistration? _pendingInvestorRegistration;
  LandownerRegistration? _pendingLandownerRegistration;
  bool _emailVerificationPending = false;

  @override
  bool get emailVerificationPending => _emailVerificationPending;

  @override
  bool get usesEmailVerificationLink => true;

  @override
  bool get passwordRecoveryPending => _passwordRecoveryPending;

  @override
  String? get recoveryEmail =>
      supabase.auth.currentUser?.email ?? _recoveryEmail;

  @override
  Stream<void> get passwordRecoveryEvents => supabase.auth.onAuthStateChange
      .where((state) => state.event == AuthChangeEvent.passwordRecovery)
      .map((_) {});

  AppUser _user(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    return AppUser(
      id: map['id'] as String? ?? '',
      name: map['name'] as String? ?? '',
      email: map['email'] as String? ?? '',
      phone: map['phone'] as String? ?? '',
      address: map['address'] as String? ?? '',
      entity: EntityType.values.firstWhere(
        (e) => e.name == map['entity'],
        orElse: () => EntityType.individual,
      ),
      hasProfilePhoto: map['hasProfilePhoto'] as bool? ?? false,
      countryCode: map['countryCode'] as String? ?? 'ZA',
      nonResident: map['nonResident'] as bool? ?? false,
    );
  }

  Future<Result<AppUser>> _loadApiSession(String token) async {
    final result = await _client.request<Object?>(
      path: '/v1/auth/supabase/session',
      method: 'POST',
      authenticated: false,
      data: {'idToken': token},
      decode: (json) => json,
    );
    if (result case Success(:final value)) {
      await _tokens.clearToken();
      await _tokens.clearRefreshToken();
      final map = Map<String, Object?>.from(value as Map);
      return Success(_user(map['user']));
    }
    return result as Failure<AppUser>;
  }

  String? get _accessToken => supabase.auth.currentSession?.accessToken;

  Future<bool> refreshSession() async {
    final session = supabase.auth.currentSession;
    if (session == null) return false;
    try {
      final expiresAt = session.expiresAt;
      if (expiresAt != null &&
          expiresAt - DateTime.now().millisecondsSinceEpoch ~/ 1000 > 60) {
        return true;
      }
      final refreshed = await supabase.auth.refreshSession();
      return refreshed.session?.accessToken.isNotEmpty == true;
    } on AuthException {
      return false;
    }
  }

  @override
  Future<Result<String>> beginInvestorRegistration(
    InvestorRegistration registration, {
    Cancellation? cancellation,
  }) async {
    if (cancellation?.isCancelled == true) {
      return const Failure(
        AppFailure(FailureKind.cancelled, 'Registration cancelled.'),
      );
    }
    try {
      await supabase.auth.signUp(
        email: registration.email.trim(),
        password: registration.password,
        emailRedirectTo: _authCallback,
        data: {
          'name': registration.name.trim(),
          'developifyRegistration': {
            'type': 'investor',
            'phone': registration.phone.trim(),
            'countryCode': registration.countryCode,
            'entity': registration.entity.name,
            'nonResident': registration.nonResident,
            if (registration.registrationNumber.isNotEmpty)
              'registrationNumber': registration.registrationNumber,
            'representatives': [
              for (final representative in registration.representatives)
                {
                  'name': representative.name,
                  'identityNumber': representative.identityNumber,
                },
            ],
          },
        },
      );
      _pendingInvestorRegistration = registration;
      _emailVerificationPending = true;
      return const Success(_investorChallenge);
    } on AuthException catch (error) {
      return Failure(_authFailure(error, registration: true));
    } on Object {
      return const Failure(
        AppFailure(
          FailureKind.network,
          'Could not reach Supabase Authentication.',
        ),
      );
    }
  }

  @override
  Future<Result<void>> verifyInvestorRegistration(
    String challengeId,
    String code, {
    Cancellation? cancellation,
  }) async {
    if (challengeId != _investorChallenge ||
        _pendingInvestorRegistration == null) {
      return const Failure(
        AppFailure(
          FailureKind.validation,
          'Investor registration expired. Start again.',
        ),
      );
    }
    if (cancellation?.isCancelled == true) {
      return const Failure(
        AppFailure(FailureKind.cancelled, 'Verification cancelled.'),
      );
    }
    try {
      if (supabase.auth.currentUser?.emailConfirmedAt == null) {
        if (code.isNotEmpty) {
          await supabase.auth.verifyOTP(
            email: _pendingInvestorRegistration!.email.trim(),
            token: code.trim(),
            type: OtpType.signup,
          );
        } else {
          final registration = _pendingInvestorRegistration!;
          await supabase.auth.signInWithPassword(
            email: registration.email.trim(),
            password: registration.password,
          );
        }
      }
      if (supabase.auth.currentUser?.emailConfirmedAt == null) {
        return const Failure(
          AppFailure(
            FailureKind.validation,
            'Open the Supabase verification link, return to the app, then try again.',
          ),
        );
      }
      return const Success(null);
    } on AuthException catch (error) {
      return Failure(_authFailure(error));
    } on Object {
      return const Failure(
        AppFailure(FailureKind.network, 'Could not verify the Supabase email.'),
      );
    }
  }

  @override
  Future<Result<AppUser>> completeInvestorRegistration(
    String challengeId, {
    Cancellation? cancellation,
  }) async {
    final registration = _pendingInvestorRegistration;
    if (challengeId != _investorChallenge || registration == null) {
      return const Failure(
        AppFailure(
          FailureKind.validation,
          'Investor registration expired. Start again.',
        ),
      );
    }
    if (cancellation?.isCancelled == true) {
      return const Failure(
        AppFailure(FailureKind.cancelled, 'Registration cancelled.'),
      );
    }
    try {
      var token = _accessToken;
      if (token == null ||
          supabase.auth.currentUser?.emailConfirmedAt == null) {
        await supabase.auth.signInWithPassword(
          email: registration.email.trim(),
          password: registration.password,
        );
        token = _accessToken;
      }
      if (token == null ||
          supabase.auth.currentUser?.emailConfirmedAt == null) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Verify your email before continuing.',
          ),
        );
      }
      final result = await _client.request<Object?>(
        path: '/v1/auth/register/investor/complete',
        method: 'POST',
        authenticated: false,
        data: {
          'idToken': token,
          'name': registration.name.trim(),
          'email': registration.email.trim(),
          'phone': registration.phone,
          'entity': registration.entity.name,
          'nonResident': registration.nonResident,
          'countryCode': registration.countryCode,
          if (registration.registrationNumber.isNotEmpty)
            'registrationNumber': registration.registrationNumber,
          if (registration.representatives.isNotEmpty)
            'representatives': [
              for (final representative in registration.representatives)
                {
                  'name': representative.name,
                  'identityNumber': representative.identityNumber,
                },
            ],
        },
        decode: (json) => json,
      );
      if (result case Success(:final value)) {
        _pendingInvestorRegistration = null;
        _emailVerificationPending = false;
        final map = Map<String, Object?>.from(value as Map);
        return Success(_user(map['user']));
      }
      return result as Failure<AppUser>;
    } on AuthException catch (error) {
      return Failure(_authFailure(error));
    } on Object {
      return const Failure(
        AppFailure(
          FailureKind.network,
          'Could not complete Supabase registration.',
        ),
      );
    }
  }

  AppFailure _authFailure(AuthException error, {bool registration = false}) {
    final raw = error.message.toLowerCase();
    final message = switch (true) {
      _
          when raw.contains('already registered') ||
              raw.contains('already been registered') =>
        registration
            ? 'An account with this email already exists. Sign in instead.'
            : 'An account with this email already exists.',
      _
          when raw.contains('invalid login credentials') ||
              raw.contains('invalid credentials') =>
        'Invalid email or password. If this account was migrated, use Forgot Password to set a Supabase password.',
      _ when raw.contains('password') && raw.contains('least') =>
        'Choose a stronger password.',
      _ when raw.contains('email') && raw.contains('valid') =>
        'Enter a valid email address.',
      _ when raw.contains('email address not authorized') =>
        'Supabase cannot send a verification email to this address yet. Configure custom SMTP in Supabase Auth, or use a project team email while testing.',
      _ when raw.contains('redirect') && raw.contains('url') =>
        'This app’s verification redirect is not allowed by Supabase. Add its /auth-callback/ URL under Authentication → URL Configuration.',
      _ when raw.contains('signup') && raw.contains('disabled') =>
        'New accounts are disabled in Supabase Auth. Enable Allow new users to sign up.',
      _ when raw.contains('too many') || raw.contains('rate limit') =>
        'Too many attempts. Please wait and try again.',
      _ when raw.contains('not confirmed') =>
        'Verify your email using the link we sent, then sign in again.',
      _ =>
        registration
            ? 'Supabase account creation failed. Check your connection and try again.'
            : 'Supabase sign-in failed. Check your credentials and try again.',
    };
    final kind = switch (true) {
      _ when raw.contains('network') => FailureKind.network,
      _ when raw.contains('not authorized') ||
          (raw.contains('redirect') && raw.contains('url')) ||
          (raw.contains('signup') && raw.contains('disabled')) =>
        FailureKind.configuration,
      _ => FailureKind.unauthenticated,
    };
    return AppFailure(kind, message);
  }

  @override
  void cancelInvestorRegistration(String challengeId) {
    if (challengeId == _investorChallenge) {
      unawaited(supabase.auth.signOut());
      _pendingInvestorRegistration = null;
      _emailVerificationPending = false;
    }
  }

  @override
  void clearSession() {
    _passwordRecoveryPending = false;
    _recoveryEmail = null;
    _pendingInvestorRegistration = null;
    _pendingLandownerRegistration = null;
    _emailVerificationPending = false;
    unawaited(supabase.auth.signOut());
    unawaited(_tokens.clearToken());
    unawaited(_tokens.clearRefreshToken());
  }

  @override
  Future<Result<AppUser>> registerLandowner(
    LandownerRegistration registration,
  ) async {
    _pendingLandownerRegistration = null;
    _emailVerificationPending = false;
    try {
      final response = await supabase.auth.signUp(
        email: registration.email.trim(),
        password: registration.password,
        emailRedirectTo: _authCallback,
        data: {
          'name': registration.name.trim(),
          'developifyRegistration': {
            'type': 'landowner',
            'phone': registration.phone.trim(),
            'countryCode': 'ZA',
            'entity': registration.entity.name,
          },
        },
      );
      final user = response.user;
      final token = response.session?.accessToken;
      if (user == null) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Supabase did not return an account.',
          ),
        );
      }
      _pendingLandownerRegistration = registration;
      if (token == null || user.emailConfirmedAt == null) {
        _emailVerificationPending = true;
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Check your email for the Supabase verification link, then sign in to finish registration.',
          ),
        );
      }
      final result = await _client.request<Object?>(
        path: '/v1/auth/register/landowner',
        method: 'POST',
        authenticated: false,
        data: {
          'name': registration.name.trim(),
          'email': registration.email.trim(),
          'phone': registration.phone,
          'countryCode': 'ZA',
          'entity': registration.entity.name,
          'idToken': token,
        },
        decode: (json) => json,
      );
      if (result case Success(:final value)) {
        _pendingLandownerRegistration = null;
        _emailVerificationPending = false;
        return Success(_user((value as Map<String, Object?>)['user']));
      }
      return result as Failure<AppUser>;
    } on AuthException catch (error) {
      return Failure(_authFailure(error, registration: true));
    } on Object {
      return const Failure(
        AppFailure(FailureKind.network, 'Could not register with Supabase.'),
      );
    }
  }

  @override
  Future<Result<AppUser>> signIn(String email, String password) async {
    try {
      final response = await supabase.auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );
      final user = response.user;
      final token = response.session?.accessToken;
      if (user == null || token == null) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Supabase did not return a signed-in user.',
          ),
        );
      }
      if (user.emailConfirmedAt == null) {
        await supabase.auth.signOut();
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Verify your email using the link we sent, then sign in again.',
          ),
        );
      }
      final pending = _pendingLandownerRegistration;
      if (pending != null &&
          user.email?.toLowerCase() == pending.email.trim().toLowerCase()) {
        final registered = await _client.request<Object?>(
          path: '/v1/auth/register/landowner',
          method: 'POST',
          authenticated: false,
          data: {
            'name': pending.name.trim(),
            'email': pending.email.trim(),
            'phone': pending.phone,
            'countryCode': 'ZA',
            'entity': pending.entity.name,
            'idToken': token,
          },
          decode: (json) => json,
        );
        if (registered case Success(:final value)) {
          _pendingLandownerRegistration = null;
          _emailVerificationPending = false;
          return Success(_user((value as Map<String, Object?>)['user']));
        }
        return registered as Failure<AppUser>;
      }
      return _loadApiSession(token);
    } on AuthException catch (error) {
      return Failure(_authFailure(error));
    } on Object {
      return const Failure(
        AppFailure(FailureKind.network, 'Could not sign in with Supabase.'),
      );
    }
  }

  @override
  Future<Result<AppUser>> socialSignIn(String provider) async {
    try {
      final oauthProvider = OAuthProvider.values.firstWhere(
        (value) => value.name == provider,
        orElse: () =>
            throw const AuthException('Unsupported sign-in provider.'),
      );
      await supabase.auth.signInWithOAuth(
        oauthProvider,
        redirectTo: _authCallback,
      );
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Complete provider sign-in in the browser, then return to the app.',
        ),
      );
    } on Object {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Social sign-in is not configured.',
        ),
      );
    }
  }

  @override
  Future<Result<void>> requestRecovery(String email) async {
    final normalizedEmail = email.trim();
    try {
      await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        redirectTo: _authCallback,
      );
      _recoveryEmail = normalizedEmail;
      return const Success(null);
    } on AuthException catch (error) {
      return Failure(_authFailure(error));
    } on Object {
      return const Failure(
        AppFailure(
          FailureKind.network,
          'Could not request a Supabase password reset.',
        ),
      );
    }
  }

  @override
  Future<Result<void>> verifyRecovery(String code) async {
    final email = recoveryEmail;
    if (email == null) {
      return const Failure(
        AppFailure(
          FailureKind.validation,
          'Start recovery with an email first.',
        ),
      );
    }
    try {
      await supabase.auth.verifyOTP(
        email: email,
        token: code.trim(),
        type: OtpType.recovery,
      );
      return const Success(null);
    } on AuthException catch (error) {
      return Failure(_authFailure(error));
    } on Object {
      return const Failure(
        AppFailure(
          FailureKind.network,
          'Could not verify the Supabase recovery code.',
        ),
      );
    }
  }

  @override
  Future<Result<void>> resetPassword(String password) async {
    if (supabase.auth.currentSession == null) {
      return const Failure(
        AppFailure(FailureKind.validation, 'Verify the recovery code first.'),
      );
    }
    try {
      await supabase.auth.updateUser(UserAttributes(password: password));
      _passwordRecoveryPending = false;
      await supabase.auth.signOut();
      _recoveryEmail = null;
      return const Success(null);
    } on AuthException catch (error) {
      return Failure(_authFailure(error));
    } on Object {
      return const Failure(
        AppFailure(
          FailureKind.network,
          'Could not update the Supabase password.',
        ),
      );
    }
  }

  @override
  void dispose() {
    unawaited(_authStateChanges.cancel());
  }
}
