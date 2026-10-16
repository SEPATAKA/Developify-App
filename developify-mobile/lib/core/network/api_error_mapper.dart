import 'package:dio/dio.dart';
import 'package:developify_mobile/core/errors/result.dart';

abstract final class ApiErrorMapper {
  static String? _authSessionMessage(DioException error) {
    if (!error.requestOptions.path.endsWith('/v1/auth/supabase/session')) {
      return null;
    }
    final response = error.response?.data;
    if (response is! Map) return null;
    final message = response['message'];
    if (message is! String) return null;
    return switch (message) {
      'Verify your email address before signing in.' =>
        'Verify your email using the link we sent, then sign in again.',
      'No Developify user profile exists for this account.' =>
        'Your email is verified, but your Developify profile is missing. Please contact support to restore your account.',
      'This Developify account is unavailable.' =>
        'This Developify account is unavailable. Please contact support.',
      'This account is linked to another identity.' =>
        'This account is already linked to a different sign-in identity. Please contact support.',
      'Invalid, expired, or revoked Supabase access token.' =>
        'Your sign-in session expired. Please sign in again.',
      'The verified account profile could not be created.' =>
        'Your account was verified, but its Developify profile could not be created. Please contact support.',
      _ => null,
    };
  }

  static AppFailure map(Object error) {
    if (error is! DioException) {
      return const AppFailure(
        FailureKind.unknown,
        'Something went wrong. Please try again.',
      );
    }
    final status = error.response?.statusCode;
    return switch (error.type) {
      DioExceptionType.cancel => const AppFailure(
        FailureKind.cancelled,
        'Request cancelled.',
      ),
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout ||
      DioExceptionType.transformTimeout => const AppFailure(
        FailureKind.timeout,
        'The request timed out. Please try again.',
      ),
      DioExceptionType.connectionError => const AppFailure(
        FailureKind.network,
        'Unable to connect. Check your connection and try again.',
      ),
      DioExceptionType.badCertificate => const AppFailure(
        FailureKind.network,
        'A secure connection could not be established.',
      ),
      DioExceptionType.badResponse => switch (status) {
        401 => AppFailure(
          FailureKind.unauthenticated,
          _authSessionMessage(error) ?? 'Please sign in again.',
          statusCode: 401,
        ),
        403 => const AppFailure(
          FailureKind.forbidden,
          'You do not have access to this action.',
          statusCode: 403,
        ),
        404 => const AppFailure(
          FailureKind.notFound,
          'This item could not be found.',
          statusCode: 404,
        ),
        400 || 422 => AppFailure(
          FailureKind.validation,
          'Check the information and try again.',
          statusCode: status,
        ),
        _ => AppFailure(
          FailureKind.server,
          'The service is unavailable. Please try again.',
          statusCode: status,
        ),
      },
      DioExceptionType.unknown => const AppFailure(
        FailureKind.unknown,
        'Something went wrong. Please try again.',
      ),
    };
  }
}
