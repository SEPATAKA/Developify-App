import 'package:developify_mobile/core/models/monetary_amount.dart';
import 'package:developify_mobile/features/investor/domain/investor_account.dart';
import 'package:developify_mobile/features/investor/domain/investment_policy.dart';

final class InvestorAccountSummary {
  const InvestorAccountSummary({
    required this.available,
    required this.investedCapital,
    required this.verification,
  });

  // Count available wallet funds plus principal still held.
  // Projected proceeds are neither available funds nor additional capital.
  InvestorAccountSummary.from(InvestorAccountSnapshot snapshot)
    : available = snapshot.balance(InvestmentPolicy.currency),
      verification = snapshot.verification,
      investedCapital = MonetaryAmount(
        _heldPrincipalCents(snapshot),
        InvestmentPolicy.currency,
      );

  static int _heldPrincipalCents(InvestorAccountSnapshot snapshot) {
    final ids = <String>{};
    return snapshot.investments
        .where(
          (holding) =>
              holding.amount.currency == InvestmentPolicy.currency &&
              holding.holdsPrincipal &&
              ids.add(holding.id),
        )
        .fold(0, (total, holding) => total + holding.amount.minorUnits);
  }

  final MonetaryAmount available;
  final MonetaryAmount investedCapital;
  final VerificationStatus verification;

  MonetaryAmount get overallBalance => available + investedCapital;
}
