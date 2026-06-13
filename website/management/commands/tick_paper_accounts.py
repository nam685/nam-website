from django.core.management.base import BaseCommand

from website.models import PaperAccount
from website.services.paper import advance_account


class Command(BaseCommand):
    help = "Advance all active paper-trading accounts by any unprocessed days."

    def handle(self, *_args, **_options):
        accounts = PaperAccount.objects.filter(is_active=True)
        for acct in accounts:
            try:
                advance_account(acct)
                self.stdout.write(f"  account {acct.id} ({acct.ticker.symbol}/{acct.strategy}): advanced")
            except Exception as e:  # noqa: BLE001
                self.stderr.write(f"  account {acct.id}: ERROR — {e}")
        self.stdout.write(f"Ticked {accounts.count()} active account(s)")
