import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';

final class FirebaseUserProfileRepository {
  const FirebaseUserProfileRepository(this._firestore);

  final FirebaseFirestore _firestore;

  Future<AppUser?> findFor(User authUser) async {
    final email = authUser.email?.trim().toLowerCase();
    if (email == null || email.isEmpty) return null;

    final profile = await _firestore
        .collection('users')
        .doc(authUser.uid)
        .get();
    if (!profile.exists) return null;

    final data = profile.data();
    if (data == null ||
        data['locked'] == true ||
        (data['firebaseUid'] != null && data['firebaseUid'] != authUser.uid) ||
        data['email'] is! String ||
        (data['email'] as String).trim().toLowerCase() != email) {
      return null;
    }

    final entity = EntityType.values.firstWhere(
      (value) => value.name == data['entity'],
      orElse: () => EntityType.individual,
    );
    final profileName = data['name'];
    final displayName = profileName is String ? profileName.trim() : '';
    final authName = authUser.displayName?.trim() ?? '';

    return AppUser(
      id: profile.id,
      name: displayName.isNotEmpty
          ? displayName
          : authName.isNotEmpty
          ? authName
          : email.split('@').first,
      email: email,
      phone: data['phone'] is String ? data['phone'] as String : '',
      address: data['address'] is String ? data['address'] as String : '',
      entity: entity,
      hasProfilePhoto: data['hasProfilePhoto'] == true,
      countryCode: data['countryCode'] is String
          ? data['countryCode'] as String
          : 'ZA',
      nonResident: data['nonResident'] == true,
    );
  }
}
