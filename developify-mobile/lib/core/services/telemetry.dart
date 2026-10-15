abstract interface class AnalyticsService {
  Future<void> screen(String name);
}

abstract interface class CrashReporter {
  Future<void> record(Object error, StackTrace stack, {bool fatal = false});
}

abstract interface class FeatureConfigService {
  int get reviewBusinessDays;
  Future<void> refresh();
}

abstract interface class PerformanceService {
  Future<T> trace<T>(String name, Future<T> Function() operation);
}

final class NoopAnalytics implements AnalyticsService {
  @override
  Future<void> screen(String name) async {}
}

final class NoopCrashReporter implements CrashReporter {
  @override
  Future<void> record(
    Object error,
    StackTrace stack, {
    bool fatal = false,
  }) async {}
}

final class DefaultFeatureConfig implements FeatureConfigService {
  @override
  int get reviewBusinessDays => 10;
  @override
  Future<void> refresh() async {}
}

final class NoopPerformance implements PerformanceService {
  @override
  Future<T> trace<T>(String name, Future<T> Function() operation) =>
      operation();
}

final class TelemetryServices {
  TelemetryServices({
    required this.analytics,
    required this.crashes,
    required this.config,
    required this.performance,
  });
  factory TelemetryServices.disabled() => TelemetryServices(
    analytics: NoopAnalytics(),
    crashes: NoopCrashReporter(),
    config: DefaultFeatureConfig(),
    performance: NoopPerformance(),
  );
  final AnalyticsService analytics;
  final CrashReporter crashes;
  final FeatureConfigService config;
  final PerformanceService performance;
  static Future<TelemetryServices> initialize() async =>
      TelemetryServices.disabled();
}
