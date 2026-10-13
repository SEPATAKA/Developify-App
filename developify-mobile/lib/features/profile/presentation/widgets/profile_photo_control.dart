import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:developify_mobile/core/assets/app_assets.dart';
import 'package:developify_mobile/core/theme/app_theme.dart';
import 'package:developify_mobile/core/widgets/app_icon.dart';

class ProfilePhotoControl extends StatelessWidget {
  const ProfilePhotoControl({
    super.key,
    required this.hasPhoto,
    required this.onChanged,
    this.photoAsset = AppAssets.avatar,
    this.photoUrl,
    this.photoBytes,
  });
  final bool hasPhoto;
  final VoidCallback onChanged;
  final String photoAsset;
  final String? photoUrl;
  final Uint8List? photoBytes;

  Widget _photo() {
    final fallback = hasPhoto
        ? Image.asset(photoAsset, fit: BoxFit.cover)
        : Image.asset(AppAssets.profileAvatarPlaceholder, fit: BoxFit.cover);
    if (photoBytes case final bytes?) {
      return Image.memory(bytes, fit: BoxFit.cover);
    }
    if (photoUrl case final url?) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => fallback,
      );
    }
    return fallback;
  }

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      SizedBox(
        width: 96.w,
        height: 91.5.w,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: (hasPhoto ? 6.85 : 6.35).w,
              top: 0,
              child: ClipOval(
                child: _photo(),
              ),
            ),
            Positioned(
              left: ((hasPhoto ? 53.91 : 58) - 5.380077).w,
              top: ((hasPhoto ? 56.180054 : 57) - 5.380077).w,
              child: Semantics(
                button: true,
                label: 'Change profile photo',
                child: InkResponse(
                  onTap: onChanged,
                  child: SizedBox.square(
                    dimension: 44.w,
                    child: Center(
                      child: Container(
                        width: 33.239845.w,
                        height: 33.239845.w,
                        decoration: BoxDecoration(
                          color: AppColors.coolGrayBackground,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.black.withValues(alpha: .17),
                              offset: Offset(6.23247.w, 10.387451.w),
                              blurRadius: 36.356079.w,
                            ),
                          ],
                        ),
                        child: const Center(
                          child: AppIcon(
                            AppAssets.profilePhotoCamera,
                            size: 17,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
      InkWell(
        key: const ValueKey('profile-change-photo'),
        onTap: onChanged,
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 13.5.w),
          child: Text(
            'Change Photo',
            style: AppTextStyles.text(
              14,
              weight: FontWeight.w600,
              color: AppColors.primary,
              height: 17 / 14,
            ),
          ),
        ),
      ),
    ],
  );
}
