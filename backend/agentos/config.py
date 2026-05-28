from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Core
    env: str = "production"
    secret_key: str
    admin_password: str

    # Database
    database_url: str = "sqlite:////data/agentos.db"

    # Redis
    redis_url: str = "redis://redis:6379"

    # GitHub
    github_token: str = ""
    github_webhook_secret: str = ""

    # Notifications
    ntfy_url: str = ""

    # Log retention
    log_retention_days: int = 30

    # Budget
    monthly_budget_usd: float = 50.0

    @property
    def is_dev(self) -> bool:
        return self.env == "development"


settings = Settings()
