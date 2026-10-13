import 'package:mobx/mobx.dart';
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/utils/lifecycle.dart';
import 'package:developify_mobile/core/storage/picked_local_file.dart';
import 'package:developify_mobile/features/profile/domain/profile_repository.dart';
part 'payout_store.g.dart';

class PayoutStore = PayoutStoreBase with _$PayoutStore;

abstract class PayoutStoreBase with Store, Lifecycle {
  PayoutStoreBase(this._repository);
  final ProfileRepository _repository;
  @observable
  String bank = '';
  @observable
  String number = '';
  @observable
  String type = '';
  @observable
  String branch = '';
  @observable
  bool proofAttached = false;
  @observable
  String? proofKey;
  @observable
  String? proofName;
  @observable
  int proofBytes = 0;
  @observable
  bool uploadingProof = false;
  @observable
  Map<String, String> errors = const {};
  @observable
  LoadStatus status = LoadStatus.initial;
  @observable
  String? error;
  @computed
  bool get dirty =>
      status != LoadStatus.success &&
      (bank.isNotEmpty ||
          number.isNotEmpty ||
          type.isNotEmpty ||
          branch.isNotEmpty ||
          proofAttached);
  Map<String, String> _validate() => {
    if (bank.isEmpty) 'bank': 'Select your bank',
    if (!RegExp(r'^\d{6,20}$').hasMatch(number))
      'number': 'Enter a valid account number',
    if (type.isEmpty) 'type': 'Select an account type',
    if (!RegExp(r'^\d{6}$').hasMatch(branch))
      'branch': 'Enter a 6-digit branch code',
    if (!proofAttached) 'proof': 'Attach a bank confirmation letter',
  };
  @computed
  bool get canSubmit =>
      status != LoadStatus.loading && !uploadingProof && _validate().isEmpty;
  void _clear(String key) {
    errors = {...errors}..remove(key);
    error = null;
    status = LoadStatus.initial;
  }

  @action
  void setBank(String value) {
    bank = value;
    _clear('bank');
  }

  @action
  void setNumber(String value) {
    number = value;
    _clear('number');
  }

  @action
  void setType(String value) {
    type = value;
    _clear('type');
  }

  @action
  void setBranch(String value) {
    branch = value;
    _clear('branch');
  }

  @action
  void attachProof(bool value) {
    proofAttached = value;
    _clear('proof');
  }

  @action
  Future<bool> uploadProof(PickedLocalFile file) async {
    if (isDisposed || uploadingProof) return false;
    uploadingProof = true;
    error = null;
    final result = await _repository.uploadFile(
      file,
      prefix: 'profile/payout',
    );
    if (isDisposed) return false;
    return runInAction(() {
      uploadingProof = false;
      switch (result) {
        case Success(:final value):
          proofKey = value;
          proofName = file.name;
          proofBytes = file.bytes.length;
          proofAttached = true;
          _clear('proof');
          return true;
        case Failure(:final error):
          this.error = error.message;
          status = LoadStatus.error;
          return false;
      }
    });
  }

  @action
  Future<bool> removeProof() async {
    if (isDisposed) return false;
    return runInAction(() {
      proofKey = null;
      proofName = null;
      proofBytes = 0;
      proofAttached = false;
      _clear('proof');
      return true;
    });
  }

  @action
  Future<bool> submit() async {
    if (isDisposed || status == LoadStatus.loading || uploadingProof) {
      return false;
    }
    errors = _validate();
    if (errors.isNotEmpty) return false;
    status = LoadStatus.loading;
    error = null;
    final request = beginRequest();
    final result = await _repository.updatePayout(
      PayoutAccount(
        bank: bank,
        number: number,
        type: type,
        branchCode: branch,
        holder: 'Themba Nkosi',
        proofKey: proofKey,
      ),
    );
    if (!isCurrent(request)) return false;
    return runInAction(() {
      if (result case Failure(:final error)) {
        status = LoadStatus.error;
        this.error = error.message;
        return false;
      }
      status = LoadStatus.success;
      return true;
    });
  }
}
