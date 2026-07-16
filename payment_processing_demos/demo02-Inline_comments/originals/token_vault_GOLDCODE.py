import base64
import hashlib
import hmac
import json
import secrets

class NexusKMSClient:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self._kek = hashlib.sha256(b"nexus-master-kek-2026-secure-hsm").digest()

    def derive_dek(self, context: str) -> bytes:
        return hmac.new(self._kek, context.encode(), hashlib.sha256).digest()

class NexusTokenVault:
    def __init__(self, kms: NexusKMSClient):
        self.kms = kms
        self.vault_storage = {}

    def mask_pan(self, pan: str) -> str:
        if len(pan) < 13 or len(pan) > 19:
            raise ValueError("Invalid PAN length")
        return pan[:6] + "*" * (len(pan) - 10) + pan[-4:]

    def tokenize_pan(self, pan: str, account_id: str) -> str:
        if not pan.isdigit() or not (13 <= len(pan) <= 19):
            raise ValueError("PAN structural validation failed")
        
        salt = secrets.token_bytes(16)
        dek = self.kms.derive_dek(account_id)
        
        token_seed = hmac.new(dek, salt, hashlib.sha256).digest()
        token = "TKN-" + base64.b32encode(token_seed).decode()[:16]
        
        iv = secrets.token_bytes(12)
        raw_payload = json.dumps({
            "pan": pan, 
            "salt": base64.b64encode(salt).decode()
        }).encode()
        
        stream_key = hashlib.pbkdf2_hmac('sha256', dek, iv, 100000, len(raw_payload))
        ciphertext = bytes(a ^ b for a, b in zip(raw_payload, stream_key))
        tag = hmac.new(dek, iv + ciphertext, hashlib.sha256).digest()
        
        self.vault_storage[token] = {
            "iv": base64.b64encode(iv).decode(),
            "ct": base64.b64encode(ciphertext).decode(),
            "tag": base64.b64encode(tag).decode()
        }
        return token

    def detokenize_token(self, token: str, account_id: str) -> str:
        if token not in self.vault_storage:
            raise KeyError("Token identifier lookup failed")
            
        payload = self.vault_storage[token]
        dek = self.kms.derive_dek(account_id)
        
        iv = base64.b64decode(payload["iv"])
        ciphertext = base64.b64decode(payload["ct"])
        tag = base64.b64decode(payload["tag"])
        
        expected_tag = hmac.new(dek, iv + ciphertext, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected_tag):
            raise PermissionError("Integrity check failed: payload tampered or key mismatch")
            
        stream_key = hashlib.pbkdf2_hmac('sha256', dek, iv, 100000, len(ciphertext))
        decrypted_payload = bytes(a ^ b for a, b in zip(ciphertext, stream_key))
        
        data = json.loads(decrypted_payload.decode())
        return data["pan"]