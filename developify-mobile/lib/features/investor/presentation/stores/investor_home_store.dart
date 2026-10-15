import 'dart:async';
import 'package:mobx/mobx.dart';
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/utils/lifecycle.dart';
import 'package:developify_mobile/features/investor/domain/account_summary.dart';
import 'package:developify_mobile/features/investor/domain/investor_account.dart';
import 'package:developify_mobile/features/investor/domain/investor_project.dart';
import 'package:developify_mobile/features/investor/domain/investor_repository.dart';
part 'investor_home_store.g.dart';

class InvestorHomeStore = InvestorHomeStoreBase with _$InvestorHomeStore;

abstract class InvestorHomeStoreBase with Store, Lifecycle {
  InvestorHomeStoreBase(this._account, this._catalog) {
    balanceVisible = _account.balanceVisible;
    _changes = _account.changes.listen((event) {
      if (isDisposed) return;
      runInAction(() => balanceVisible = _account.balanceVisible);
      if (event.kinds.contains(InvestorDataKind.privacy)) return;
      if (isDisposed) return;
      if (event.kinds.contains(InvestorDataKind.scope)) {
        runInAction(() {
          summary = null;
          balanceStatus = LoadStatus.initial;
          status = LoadStatus.initial;
          projects = const [];
          error = null;
        });
      }
      unawaited(load());
    });
    _catalogChanges = _catalog.changes.listen((_) {
      if (!isDisposed) {
        runInAction(() {
          favourites = _catalog.favouriteIds;
          projects = projects
              .map((p) => _catalog.currentProject(p.id))
              .whereType<InvestorProject>()
              .toList();
        });
      }
    });
  }
  final InvestorAccountRepository _account;
  final InvestorCatalogRepository _catalog;
  late final StreamSubscription<InvestorAccountChange> _changes;
  late final StreamSubscription<void> _catalogChanges;
  @observable
  bool balanceVisible = true;
  @action
  void toggleBalance() => _account.setBalanceVisible(!balanceVisible);
  @observable
  LoadStatus status = LoadStatus.initial;
  @observable
  LoadStatus balanceStatus = LoadStatus.initial;
  @observable
  InvestorAccountSummary? summary;
  @observable
  List<InvestorProject> projects = const [];
  @observable
  Set<String> favourites = const {};
  @observable
  String? error;
  @action
  Future<void> load() async {
    if (isDisposed) return;
    final request = beginRequest();
    status = LoadStatus.loading;
    balanceStatus = LoadStatus.loading;
    error = null;
    final results = await (_account.balance(), _catalog.projects()).wait;
    if (!isCurrent(request)) return;
    runInAction(() {
      if (results.$1 case Success<InvestorAccountSummary>(:final value)) {
        summary = value;
        balanceStatus = LoadStatus.success;
      } else if (results.$1 case Failure(:final error)) {
        summary = null;
        balanceStatus = LoadStatus.error;
        this.error = error.message;
      }

      if (results.$2 case Success<List<InvestorProject>>(:final value)) {
        projects = value;
        favourites = _catalog.favouriteIds;
      } else if (results.$2 case Failure(:final error)) {
        this.error ??= error.message;
      }
      status =
          balanceStatus == LoadStatus.error || error != null
              ? LoadStatus.error
              : projects.isEmpty
              ? LoadStatus.empty
              : LoadStatus.success;
    });
  }

  @action
  Future<void> toggleFavourite(String id) async {
    if (isDisposed) return;
    error = null;
    final result = await _catalog.setFavourite(id, !favourites.contains(id));
    if (isDisposed) return;
    if (result case Failure(
      :final error,
    ) when error.kind != FailureKind.cancelled) {
      runInAction(() => this.error = error.message);
    }
  }

  @override
  void dispose() {
    unawaited(_changes.cancel());
    unawaited(_catalogChanges.cancel());
    super.dispose();
  }
}
