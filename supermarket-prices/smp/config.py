from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://smp:smp@localhost:5432/smp"
    dumps_dir: str = "./dumps"
    api_key: str = ""  # empty = no auth (local dev only!)


settings = Settings()
