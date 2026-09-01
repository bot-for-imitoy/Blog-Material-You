#!/usr/bin/env python3
"""Blog Material You — minimal S3 client used by the imghost module.

Supports MinIO / AWS S3 / any S3-compatible endpoint, including:
  * TLS with a custom CA bundle       (config file: ca_bundle = ...)
  * mutual TLS / client certificates  (config file: client_cert = ...)
  * plain HTTP / skip verification    (--insecure)

Credentials and TLS settings are read from the AWS config/credentials files
pointed at by AWS_SHARED_CREDENTIALS_FILE / AWS_CONFIG_FILE (written by the
Lua backend), so secrets never appear on the command line.

Usage:
  s3.py --endpoint URL --bucket NAME [--region R] [--insecure] cp --file F --key K
  s3.py --endpoint URL --bucket NAME [--region R] [--insecure] ls [--prefix P]
"""

import argparse
import os
import sys

import boto3
from botocore.client import Config


def build_client(args):
    endpoint = args.endpoint
    if not endpoint.startswith(("http://", "https://")):
        endpoint = "https://" + endpoint

    verify = None
    if args.insecure:
        verify = False
    elif args.ca:
        verify = args.ca

    # Mutual TLS: botocore only accepts the client certificate via Config();
    # the paths are not secrets (the key material lives in the files).
    config_kwargs = {
        "signature_version": "s3v4",
        "s3": {"addressing_style": "path"},
        "retries": {"max_attempts": 2},
    }
    if args.client_cert:
        config_kwargs["client_cert"] = args.client_cert

    # Credentials are read by botocore from the files pointed at by
    # AWS_SHARED_CREDENTIALS_FILE / AWS_CONFIG_FILE, which the Lua backend
    # writes — nothing secret appears on the command line.
    session = boto3.session.Session()
    return session.client(
        "s3",
        endpoint_url=endpoint,
        region_name=args.region or "us-east-1",
        config=Config(**config_kwargs),
        verify=verify,
    )


def main():
    parser = argparse.ArgumentParser(description="Minimal S3 client for Blog Material You")
    parser.add_argument("--endpoint", required=True, help="S3 endpoint URL, e.g. https://minio:9000")
    parser.add_argument("--bucket", required=True, help="bucket name")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--insecure", action="store_true", help="skip TLS certificate verification")
    parser.add_argument("--ca", default="", help="CA bundle path used to verify the server")
    parser.add_argument("--client-cert", default="", help="client certificate bundle (cert + key) for mutual TLS")
    sub = parser.add_subparsers(dest="cmd", required=True)

    cp = sub.add_parser("cp", help="upload a file")
    cp.add_argument("--file", required=True)
    cp.add_argument("--key", required=True)

    ls = sub.add_parser("ls", help="list objects")
    ls.add_argument("--prefix", default="")

    args = parser.parse_args()
    client = build_client(args)

    if args.cmd == "cp":
        client.upload_file(args.file, args.bucket, args.key)
        print("OK")
    elif args.cmd == "ls":
        resp = client.list_objects_v2(Bucket=args.bucket, Prefix=args.prefix, MaxKeys=10)
        keys = [obj["Key"] for obj in resp.get("Contents", [])]
        if keys:
            for k in keys:
                print(k)
        else:
            print("(empty)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — surface a clean error to the caller
        print("ERROR: %s" % exc, file=sys.stderr)
        sys.exit(1)
