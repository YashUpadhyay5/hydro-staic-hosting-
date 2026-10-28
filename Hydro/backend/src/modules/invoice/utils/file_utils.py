import json
import os


def ensure_directory(path: str):

    os.makedirs(path, exist_ok=True)


def read_json(path: str):

    with open(path, "r", encoding="utf-8") as file:

        return json.load(file)


def write_json(path: str, data: dict):

    with open(path, "w", encoding="utf-8") as file:

        json.dump(
            data,
            file,
            indent=4,
            ensure_ascii=False
        )