"""Thin wrapper around il-supermarket-scraper (pip install il-supermarket-scraper).

!! Needs live testing !!  - run from an Israeli IP (some chain sites block foreign IPs)
                          - chain names change between scraper versions: run `smp scrape --list`
                          - verify the scraper's LICENSE before any commercial use (see README)
Note: the PyPI package is *distributed* as `il-supermarket-scraper` but *imported* as `il_supermarket_scarper` (sic).
"""
from datetime import datetime


def list_chains() -> list[str]:
    from il_supermarket_scarper import ScraperFactory
    return ScraperFactory.all_scrapers_name()


def run_scrape(dumps_dir: str, chains: list[str] | None = None, limit: int | None = None,
               file_types: list[str] | None = None, processes: int = 3):
    from il_supermarket_scarper import ScarpingTask
    from il_supermarket_scarper.utils.files.file_types import FileTypesFilters

    task = ScarpingTask(
        enabled_scrapers=chains or None,
        files_types=file_types or [FileTypesFilters.STORE_FILE.name, FileTypesFilters.PRICE_FULL_FILE.name],
        multiprocessing=processes,
        output_configuration={"output_mode": "disk", "base_storage_path": dumps_dir},
        status_configuration={"database_type": "json", "base_path": f"{dumps_dir}/status"},
    )
    task.start(limit=limit, when_date=None, single_pass=True)
    task.join()
    return datetime.now()
