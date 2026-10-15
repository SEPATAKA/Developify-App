import 'dart:typed_data';

import 'package:cross_file/cross_file.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:file_picker/file_picker.dart';
import 'package:developify_mobile/app/app.dart';
import 'package:developify_mobile/app/di/app_dependencies.dart';
import 'package:developify_mobile/app/environment/app_environment.dart';
import 'package:developify_mobile/app/router/app_router.dart';
import 'package:developify_mobile/core/widgets/app_button.dart';
import 'package:developify_mobile/core/storage/device_file_picker.dart';
import 'package:developify_mobile/features/investor/data/mock_kyc_repository.dart';
import 'package:developify_mobile/features/investor/domain/kyc/kyc_repository.dart';
import 'package:developify_mobile/features/investor/presentation/screens/kyc_screen.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';
import 'helpers/fonts.dart';

final class _TestPlatformFile extends PlatformFile {
  _TestPlatformFile(this.name, this._bytes);

  @override
  final String name;
  final Uint8List _bytes;

  @override
  Uri get uri => Uri.parse('memory:$name');

  @override
  XFile get xFile => XFile.fromData(_bytes, name: name);

  @override
  int? lengthSync() => _bytes.length;

  @override
  Future<int?> length() async => _bytes.length;

  @override
  Future<Uint8List> readAsBytes() async => Uint8List.fromList(_bytes);

  @override
  Stream<Uint8List> readAsByteStream() => Stream.value(_bytes);
}

final class _TestFilePickerPlatform extends FilePickerPlatform {
  final file = _TestPlatformFile(
    'addressProof.pdf',
    Uint8List.fromList([1, 2, 3]),
  );
  final secondFile = _TestPlatformFile(
    'addressProof-2.pdf',
    Uint8List.fromList([4, 5, 6]),
  );
  var singleCalls = 0;
  var multipleCalls = 0;

  @override
  Future<PlatformFile?> pickFile({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    void Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    AndroidOptions androidOptions = const AndroidOptions(),
    DarwinOptions darwinOptions = const DarwinOptions(),
    WindowsOptions windowsOptions = const WindowsOptions(),
    LinuxOptions linuxOptions = const LinuxOptions(),
    WebOptions webOptions = const WebOptions(),
  }) async {
    singleCalls++;
    return file;
  }

  @override
  Future<List<PlatformFile>> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    void Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    AndroidOptions androidOptions = const AndroidOptions(),
    DarwinOptions darwinOptions = const DarwinOptions(),
    WindowsOptions windowsOptions = const WindowsOptions(),
    LinuxOptions linuxOptions = const LinuxOptions(),
    WebOptions webOptions = const WebOptions(),
  }) async {
    multipleCalls++;
    return [file, secondFile];
  }
}

void main() {
  setUpAll(loadAppFonts);
  test('Device picker uses single and multi-file platform APIs', () async {
    final originalPicker = FilePickerPlatform.instance;
    final platform = _TestFilePickerPlatform();
    FilePickerPlatform.instance = platform;
    addTearDown(() => FilePickerPlatform.instance = originalPicker);

    const picker = PlatformDeviceFilePicker();
    final single = await picker.pick(extensions: const ['pdf']);
    final multiple = await picker.pick(
      extensions: const ['pdf'],
      allowMultiple: true,
    );

    expect(single?.map((file) => file.name), ['addressProof.pdf']);
    expect(multiple?.map((file) => file.name), [
      'addressProof.pdf',
      'addressProof-2.pdf',
    ]);
    expect(platform.singleCalls, 1);
    expect(platform.multipleCalls, 1);
  });

  for (final width in [360.0, 393.0, 430.0]) {
    testWidgets(
      'Document upload cancels and retries at $width with enlarged text',
      (tester) async {
        final originalPicker = FilePickerPlatform.instance;
        FilePickerPlatform.instance = _TestFilePickerPlatform();
        addTearDown(() => FilePickerPlatform.instance = originalPicker);
        tester.view.physicalSize = Size(width, 852);
        tester.view.devicePixelRatio = 1;
        tester.view.padding = const FakeViewPadding(top: 56, bottom: 34);
        tester.platformDispatcher.textScaleFactorTestValue = 1.6;
        tester.platformDispatcher.accessibilityFeaturesTestValue =
            const FakeAccessibilityFeatures(disableAnimations: true);
        addTearDown(tester.view.reset);
        addTearDown(tester.platformDispatcher.clearAllTestValues);
        final dependencies = await AppDependencies.create(
          environment: const AppEnvironment(
            mockDelay: Duration(seconds: 2),
            mockScenario: MockScenario.incompleteKyc,
          ),
        );
        dependencies.session.signIn(
          const AppUser(
            id: 'document-upload',
            name: 'Babatunde Yusuf',
            email: 'investor@example.test',
          ),
          experience: Experience.investor,
        );
        final router = createAppRouter(
          dependencies,
          initialLocation: '/investor/kyc/individual/address',
        );
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          router.dispose();
          await tester.runAsync(dependencies.dispose);
        });
        await tester.pumpWidget(
          DevelopifyApp(dependencies: dependencies, router: router),
        );
        await tester.pump(const Duration(seconds: 2));
        await tester.pumpAndSettle();
        final store = tester.widget<KycScreen>(find.byType(KycScreen)).store;
        Future<void> start() async {
          final upload = find.bySemanticsLabel(
            RegExp('^Choose a file for Upload'),
          );
          await tester.scrollUntilVisible(upload, 200);
          await tester.tap(upload);
          await tester.pump(const Duration(milliseconds: 300));
          expect(find.text('Uploading...'), findsOneWidget);
          expect(
            tester
                .widget<AppButton>(
                  find.byWidgetPredicate(
                    (widget) =>
                        widget is AppButton && widget.label == 'Continue',
                  ),
                )
                .onPressed,
            isNull,
          );
          expect(store.draft!.documents.containsKey('addressProof'), isFalse);
        }

        await start();
        final cancel = find.bySemanticsLabel('Cancel document upload');
        await tester.ensureVisible(cancel);
        await tester.tap(cancel);
        await tester.pumpAndSettle();
        await tester.pump(const Duration(seconds: 3));
        expect(store.documentUploads, isEmpty);
        expect(store.draft!.documents.containsKey('addressProof'), isFalse);
        final repository =
            dependencies.container<KycRepository>() as MockKycRepository;
        repository.behavior.failNext();
        await start();
        await tester.pump(const Duration(seconds: 2));
        await tester.pumpAndSettle();
        expect(find.text('Failed'), findsOneWidget);
        expect(store.draft!.documents.containsKey('addressProof'), isFalse);
        final retry = find.text('Try Again');
        await tester.ensureVisible(retry);
        await tester.tap(retry);
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.text('Uploading...'), findsOneWidget);
        expect(store.canContinue, isFalse);
        await tester.pump(const Duration(seconds: 2));
        await tester.pumpAndSettle();
        expect(find.text('Completed'), findsOneWidget);
        expect(store.canContinue, isTrue);
        expect(store.documentUploads, isEmpty);
        expect(
          store.draft!.documents['addressProof']!.name,
          'addressProof.pdf',
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
