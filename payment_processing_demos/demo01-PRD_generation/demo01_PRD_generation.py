import hashlib
import hmac
import time
import uuid
from typing import Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum

class Currency(Enum):
    GBP = "GBP"
    EUR = "EUR"
    USD = "USD"

class Route(Enum):
    FASTER_PAYMENTS = "FPS"
    SEPA = "SEPA"
    SWIFT = "SWIFT"

class PaymentStatus(Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REJECTED_SANCTIONS = "REJECTED_SANCTIONS"

@dataclass
class PaymentRequest:
    transaction_id: str
    sender_iban: str
    receiver_iban: str
    amount: float
    currency: Currency
    sender_name: str
    receiver_name: str

class SanctionScreeningError(Exception):
    pass

class RoutingError(Exception):
    pass

class PaymentRouter:
    def __init__(self, secret_key: bytes, mock_sanctions_list: list[str]):
        self.secret_key = secret_key
        self.mock_sanctions_list = [name.lower() for name in mock_sanctions_list]
        self.max_fps_limit = 250000.00  # UK Faster Payments limit

    def _generate_integrity_hash(self, payload: str) -> str:
        return hmac.new(self.secret_key, payload.encode('utf-8'), hashlib.sha256).hexdigest()

    def _screen_parties(self, request: PaymentRequest) -> None:
        sender_clean = request.sender_name.strip().lower()
        receiver_clean = request.receiver_name.strip().lower()
        
        if sender_clean in self.mock_sanctions_list or receiver_clean in self.mock_sanctions_list:
            raise SanctionScreeningError(
                f"AML/Sanctions Match Found: Transaction {request.transaction_id} rejected."
            )

    def determine_route(self, request: PaymentRequest) -> Route:
        if request.currency == Currency.GBP:
            if request.amount <= self.max_fps_limit:
                return Route.FASTER_PAYMENTS
            return Route.SWIFT
            
        elif request.currency == Currency.EUR:
            return Route.SEPA
            
        elif request.currency == Currency.USD:
            return Route.SWIFT
            
        else:
            raise RoutingError(f"No viable clearing route found for currency {request.currency.value}")

    def _execute_network_call_with_retry(self, route: Route, payload: Dict[str, Any], retries: int = 3, delay: float = 0.5) -> bool:
        # Simulating external API call with temporary network flakiness
        for attempt in range(retries):
            try:
                if attempt < retries - 1 and int(time.time()) % 2 == 0:
                    raise ConnectionError("Transient network failure on gateway API")
                
                # Mock successful gateway response
                return True
            except ConnectionError:
                time.sleep(delay * (2 ** attempt))
        return False

    def process_payment(self, request: PaymentRequest) -> Dict[str, Any]:
        start_time = time.time()
        
        try:
            self._screen_parties(request)
            route = self.determine_route(request)
            
            payload_data = f"{request.transaction_id}|{request.amount}|{request.currency.value}"
            integrity_signature = self._generate_integrity_hash(payload_data)
            
            api_payload = {
                "tx_id": request.transaction_id,
                "amount_cents": int(request.amount * 100),
                "currency": request.currency.value,
                "source_account": request.sender_iban,
                "dest_account": request.receiver_iban,
                "routing_rail": route.value,
                "signature": integrity_signature
            }
            
            success = self._execute_network_call_with_retry(route, api_payload)
            
            if not success:
                raise RoutingError("Payment gateway connection exhausted retries.")
                
            return {
                "transaction_id": request.transaction_id,
                "status": PaymentStatus.COMPLETED.value,
                "route_used": route.value,
                "processed_at": int(time.time()),
                "latency_ms": round((time.time() - start_time) * 1000, 2),
                "signature": integrity_signature
            }
            
        except SanctionScreeningError as s_err:
            return {
                "transaction_id": request.transaction_id,
                "status": PaymentStatus.REJECTED_SANCTIONS.value,
                "error": str(s_err),
                "processed_at": int(time.time()),
                "latency_ms": round((time.time() - start_time) * 1000, 2)
            }
        except Exception as err:
            return {
                "transaction_id": request.transaction_id,
                "status": PaymentStatus.FAILED.value,
                "error": str(err),
                "processed_at": int(time.time()),
                "latency_ms": round((time.time() - start_time) * 1000, 2)
            }