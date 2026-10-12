import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/core/storage/token_storage.dart';
import 'package:developify_mobile/core/utils/cancellation.dart';
import 'package:developify_mobile/features/authentication/domain/auth_repository.dart';
import 'package:developify_mobile/features/authentication/domain/investor_registration.dart';
import 'package:developify_mobile/features/authentication/domain/landowner_registration.dart';
import 'package:developify_mobile/features/authentication/data/firebase_user_profile_repository.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';

final class ApiAuthRepository implements AuthRepository {
  ApiAuthRepository(
    this._client,
    this._tokens, {
    this.firebaseAuth,
    this.firebaseProfiles,
  });
  final ApiClient _client;
  final TokenStorage _tokens;
  final FirebaseAuth? firebaseAuth;
  final FirebaseUserProfileRepository? firebaseProfiles;
  String? _recoveryChallengeId;
  String? _recoveryEmail;
  InvestorRegistration? _pendingInvestorRegistration;
  bool _emailVerificationPending = false;

  @override
  bool get emailVerificationPending => _emailVerificationPending;

  @override
  bool get usesFirebaseEmailLink => true;

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

  Future<Result<AppUser>> _storeSession(Object? json) async {
    final map = json as Map<String, Object?>? ?? const {};
    final access = map['accessToken'] as String?;
    if (access != null) await _tokens.writeToken(access);
    await _tokens.clearRefreshToken();
    return Success(_user(map['user']));
  }

  Future<bool> refreshSession() async {
    final auth = firebaseAuth;
    if (auth == null || auth.currentUser == null) return false;
    final token = await auth.currentUser!.getIdToken(true);
    return token != null && token.isNotEmpty;
  }

  @override
  Future<Result<String>> beginInvestorRegistration(
    InvestorRegistration registration, {
    Cancellation? cancellation,
  }) async {
    if (firebaseAuth == null) {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Firebase Authentication is not configured for this build.',
        ),
      );
    }
    try {
      final auth = firebaseAuth!;
      UserCredential credential;
      try {
        credential = await auth.createUserWithEmailAndPassword(
          email: registration.email.trim(),
          password: registration.password,
        );
      } on FirebaseAuthException catch (error) {
        if (error.code != 'email-already-in-use') rethrow;
        credential = await auth.signInWithEmailAndPassword(
          email: registration.email.trim(),
          password: registration.password,
        );
      }
      final user = credential.user;
      if (user == null) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Firebase did not return a registered user.',
          ),
        );
      }
      await user.updateDisplayName(registration.name.trim());
      await user.reload();
      final currentUser = auth.currentUser;
      if (currentUser != null && !currentUser.emailVerified) {
        await currentUser.sendEmailVerification();
      }
      _pendingInvestorRegistration = registration;
      return const Success('firebase-investor-registration');
    } on FirebaseAuthException catch (error) {
      return Failure(_firebaseAuthFailure(error, registration: true));
    } on FirebaseException {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Firebase Authentication is unavailable in this build.',
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
    if (challengeId != 'firebase-investor-registration') {
      return const Failure(
        AppFailure(FailureKind.validation, 'Investor registration expired.'),
      );
    }
    if (code.isNotEmpty) {
      return const Failure(
        AppFailure(
          FailureKind.validation,
          'Use the email verification link sent by Firebase.',
        ),
      );
    }
    final user = firebaseAuth?.currentUser;
    if (user == null ||
        user.email?.toLowerCase().trim() !=
            _pendingInvestorRegistration?.email.toLowerCase().trim()) {
      return const Failure(
        AppFailure(
          FailureKind.unauthenticated,
          'Sign in again to verify this registration.',
        ),
      );
    }
    try {
      await user.reload();
      if (firebaseAuth?.currentUser?.emailVerified != true) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Open the verification link in your email, then try again.',
          ),
        );
      }
      await firebaseAuth?.currentUser?.getIdToken(true);
      return const Success(null);
    } on FirebaseAuthException catch (error) {
      return Failure(_firebaseAuthFailure(error));
    } on FirebaseException {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Firebase Authentication is unavailable in this build.',
        ),
      );
    }
  }

  @override
  Future<Result<AppUser>> completeInvestorRegistration(
    String challengeId, {
    Cancellation? cancellation,
  }) {
    return _completeFirebaseInvestorRegistration(challengeId);
  }

  Future<Result<AppUser>> _completeFirebaseInvestorRegistration(
    String challengeId,
  ) async {
    if (challengeId != 'firebase-investor-registration') {
      return const Failure(
        AppFailure(FailureKind.validation, 'Investor registration expired.'),
      );
    }
    final auth = firebaseAuth;
    final registration = _pendingInvestorRegistration;
    if (auth == null || registration == null) {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Firebase registration is unavailable. Restart account creation.',
        ),
      );
    }
    try {
      User? user = auth.currentUser;
      if (user?.email?.toLowerCase().trim() !=
          registration.email.toLowerCase().trim()) {
        UserCredential credential;
        try {
          credential = await auth.createUserWithEmailAndPassword(
            email: registration.email.trim(),
            password: registration.password,
          );
        } on FirebaseAuthException catch (error) {
          if (error.code != 'email-already-in-use') rethrow;
          credential = await auth.signInWithEmailAndPassword(
            email: registration.email.trim(),
            password: registration.password,
          );
        }
        user = credential.user;
      }
      if (user == null) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Firebase did not return a registered user.',
          ),
        );
      }
      await user.updateDisplayName(registration.name.trim());
      final idToken = await user.getIdToken(true);
      if (idToken == null || idToken.isEmpty) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Could not obtain a Firebase registration token.',
          ),
        );
      }
      final result = await _client.request<Object?>(
        path: '/v1/auth/register/investor/complete',
        method: 'POST',
        authenticated: false,
        data: {
          'idToken': idToken,
          'name': registration.name,
          'email': registration.email,
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
        final response = Map<String, Object?>.from(value as Map);
        final refreshedToken = await auth.currentUser?.getIdToken(true);
        if (refreshedToken != null) response['accessToken'] = refreshedToken;
        _pendingInvestorRegistration = null;
        return await _storeSession(response);
      }
      return result as Failure<AppUser>;
    } on FirebaseAuthException catch (error) {
      return Failure(_firebaseAuthFailure(error, registration: true));
    } on FirebaseException {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Firebase Authentication is unavailable in this build.',
        ),
      );
    }
  }

  AppFailure _firebaseAuthFailure(
    FirebaseAuthException error, {
    bool registration = false,
  }) {
    final message = switch (error.code) {
      'email-already-in-use' =>
        registration
            ? 'A Firebase account already exists for this email. Sign in instead.'
            : 'An account with this email already exists.',
      'invalid-credential' ||
      'user-not-found' ||
      'wrong-password' => 'Invalid email or password.',
      'weak-password' => 'Choose a stronger password.',
      'invalid-email' => 'Enter a valid email address.',
      'too-many-requests' => 'Too many attempts. Please wait and try again.',
      'network-request-failed' =>
        'Unable to reach Firebase. Check your connection and try again.',
      'user-disabled' => 'This account is disabled.',
      _ =>
        registration
            ? 'Firebase account creation failed. Please try again.'
            : 'Firebase sign-in failed. Please try again.',
    };
    return AppFailure(
      error.code == 'network-request-failed'
          ? FailureKind.network
          : FailureKind.unauthenticated,
      message,
    );
  }

  Future<Result<AppUser>> _firebaseSignIn(String email, String password) async {
    final auth = firebaseAuth;
    if (auth == null) {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Firebase Authentication is not configured for this build.',
        ),
      );
    }
    try {
      final credential = await auth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      final user = credential.user;
      if (user == null) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Firebase did not return a signed-in user.',
          ),
        );
      }
      await user.reload();
      final refreshedUser = auth.currentUser;
      if (refreshedUser == null || !refreshedUser.emailVerified) {
        await user.sendEmailVerification();
        await auth.signOut();
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Verify your email using the link we just sent, then sign in again.',
          ),
        );
      }
      final idToken = await refreshedUser.getIdToken(true);
      if (idToken == null || idToken.isEmpty) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Could not obtain a Firebase sign-in token.',
          ),
        );
      }
      final profiles = firebaseProfiles;
      if (profiles == null) {
        await auth.signOut();
        return const Failure(
          AppFailure(
            FailureKind.configuration,
            'Firebase user profiles are not configured for this build.',
          ),
        );
      }
      final profile = await profiles.findFor(refreshedUser);
      if (profile == null) {
        await auth.signOut();
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'No active Developify profile is linked to this Firebase account.',
          ),
        );
      }
      return Success(profile);
    } on FirebaseAuthException catch (error) {
      return Failure(_firebaseAuthFailure(error));
    } on FirebaseException catch (error) {
      final permissionDenied = error.code == 'permission-denied';
      return Failure(
        AppFailure(
          permissionDenied ? FailureKind.configuration : FailureKind.network,
          permissionDenied
              ? 'Firestore rules do not allow this account to read its user profile. Deploy the project Firestore rules and try again.'
              : 'Could not load your Developify profile from Firebase. Check your connection and Firestore access, then try again.',
        ),
      );
    }
  }

  @override
  void cancelInvestorRegistration(String challengeId) {
    if (challengeId == 'firebase-investor-registration') {
      unawaited(firebaseAuth?.signOut());
      _pendingInvestorRegistration = null;
    }
  }

  @override
  void clearSession() {
    _recoveryChallengeId = null;
    _recoveryEmail = null;
    _pendingInvestorRegistration = null;
    _emailVerificationPending = false;
    unawaited(firebaseAuth?.signOut());
  }

  @override
  Future<Result<AppUser>> registerLandowner(
    LandownerRegistration registration,
  ) {
    return _registerFirebaseLandowner(registration);
  }

  Future<Result<AppUser>> _registerFirebaseLandowner(
    LandownerRegistration registration,
  ) async {
    final auth = firebaseAuth;
    if (auth == null) {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Firebase Authentication is not configured for this build.',
        ),
      );
    }
    try {
      late final UserCredential credential;
      try {
        credential = await auth.createUserWithEmailAndPassword(
          email: registration.email.trim(),
          password: registration.password,
        );
      } on FirebaseAuthException catch (error) {
        if (error.code != 'email-already-in-use') rethrow;
        credential = await auth.signInWithEmailAndPassword(
          email: registration.email.trim(),
          password: registration.password,
        );
      }
      final user = credential.user;
      if (user == null) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Firebase did not return a registered user.',
          ),
        );
      }
      await user.updateDisplayName(registration.name.trim());
      await user.reload();
      final refreshedUser = auth.currentUser;
      if (refreshedUser == null) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Firebase did not return a registered user.',
          ),
        );
      }
      if (!refreshedUser.emailVerified) {
        await refreshedUser.sendEmailVerification();
      }
      final idToken = await refreshedUser.getIdToken(true);
      if (idToken == null || idToken.isEmpty) {
        return const Failure(
          AppFailure(
            FailureKind.unauthenticated,
            'Could not obtain a Firebase registration token.',
          ),
        );
      }
      final result = await _client.request<Object?>(
        path: '/v1/auth/register/landowner',
        method: 'POST',
        authenticated: false,
        data: {
          'name': registration.name,
          'email': registration.email.trim(),
          'phone': registration.phone,
          'countryCode': 'ZA',
          'entity': registration.entity.name,
          'idToken': idToken,
        },
        decode: (json) => json,
      );
      if (result case Success(:final value)) {
        _emailVerificationPending = !refreshedUser.emailVerified;
        final response = Map<String, Object?>.from(value as Map)
          ..['accessToken'] = idToken;
        if (_emailVerificationPending) await auth.signOut();
        return await _storeSession(response);
      }
      return result as Failure<AppUser>;
    } on FirebaseAuthException catch (error) {
      return Failure(_firebaseAuthFailure(error, registration: true));
    } on FirebaseException {
      return const Failure(
        AppFailure(
          FailureKind.configuration,
          'Firebase Authentication is unavailable in this build.',
        ),
      );
    }
  }

  @override
  Future<Result<AppUser>> signIn(String email, String password) {
    return _firebaseSignIn(email, password).then((result) {
      if (result case Success()) _emailVerificationPending = false;
      return result;
    });
  }

  @override
  Future<Result<AppUser>> socialSignIn(String provider) {
    return Future.value(
      const Failure(
        AppFailure(
          FailureKind.configuration,
          'Social sign-in is not configured for this Firebase project.',
        ),
      ),
    );
  }

  @override
  Future<Result<void>> requestRecovery(String email) async {
    _recoveryEmail = email;
    return _client.request(
      path: '/v1/auth/recovery/request',
      method: 'POST',
      authenticated: false,
      data: {'email': email},
      decode: (_) {},
    );
  }

  @override
  Future<Result<void>> verifyRecovery(String code) async {
    final email = _recoveryEmail;
    if (email == null) {
      return const Failure(
        AppFailure(
          FailureKind.validation,
          'Start recovery with an email first.',
        ),
      );
    }
    final result = await _client.request<Object?>(
      path: '/v1/auth/recovery/verify',
      method: 'POST',
      authenticated: false,
      data: {'email': email, 'code': code},
      decode: (json) => json,
    );
    if (result case Success(:final value)) {
      _recoveryChallengeId =
          (value as Map<String, Object?>)['challengeId'] as String?;
      return const Success(null);
    }
    return result as Failure<void>;
  }

  @override
  Future<Result<void>> resetPassword(String password) async {
    final challengeId = _recoveryChallengeId;
    if (challengeId == null) {
      return const Failure(
        AppFailure(FailureKind.validation, 'Verify the recovery code first.'),
      );
    }
    return _client.request(
      path: '/v1/auth/recovery/reset',
      method: 'POST',
      authenticated: false,
      data: {'challengeId': challengeId, 'password': password},
      decode: (_) {},
    );
  }
}
