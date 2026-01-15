"""Configuration loading for charting app"""
from pathlib import Path
import yaml
from typing import Dict


def load_config() -> Dict:
    """Load charting app configuration"""
    config_path = Path(__file__).parent.parent.parent / "config" / "charting.yaml"

    if not config_path.exists():
        # Default config
        return {
            'app': {
                'name': 'Momentum Trader Charts',
                'version': '1.0.0'
            },
            'data_sources': {
                'momentum_trader': {
                    'data_dir': str(Path(__file__).parent.parent.parent.parent / "momentum-trader" / "data"),
                    'api_url': 'http://localhost:8080'
                }
            }
        }

    with open(config_path) as f:
        return yaml.safe_load(f)
