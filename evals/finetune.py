"""Fine-tune (SFT) an Azure OpenAI model on the dataset built from Foundry
traces, then (optionally) deploy the resulting fine-tuned model.

Pipeline:
  1. Upload ``sft/train.jsonl`` (+ ``validation.jsonl``) to the Azure OpenAI
     account with purpose ``fine-tune``.
  2. Create a fine-tuning job for the base model (default ``gpt-4.1-mini``).
  3. Optionally poll the job to completion (``--poll``) and deploy the
     fine-tuned model (``--deploy``).

Fine-tuning is billable and can take from minutes to hours. Deploying a
fine-tuned model incurs hosting cost until you delete the deployment.

Usage:
    python evals/finetune.py aurelia-motors --model gpt-4.1-mini
    python evals/finetune.py aurelia-motors --poll          # wait for completion
    python evals/finetune.py aurelia-motors --job <id> --poll --deploy
    python evals/finetune.py aurelia-motors --job <id> --deploy --deploy-name aurelia-ft

Requires ``az login`` with access to the Azure OpenAI (Foundry) account. The
account has key auth disabled, so Entra ID is used.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import time
from urllib.parse import urlparse

from _common import load_agent_config, load_azd_env, resolve_agent_dir

TERMINAL = {"succeeded", "failed", "cancelled", "canceled"}


def openai_account_endpoint(project_endpoint: str) -> str:
    """Derive the Azure OpenAI data-plane endpoint for the Foundry account."""
    host = urlparse(project_endpoint).hostname or ""
    account = host.split(".")[0]
    return f"https://{account}.openai.azure.com"


def _client(api_version: str):
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
    from openai import AzureOpenAI

    project_endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
    endpoint = os.environ.get("FOUNDRY_ACCOUNT_OPENAI_ENDPOINT") or openai_account_endpoint(project_endpoint)
    token_provider = get_bearer_token_provider(
        DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
    )
    print(f"Azure OpenAI endpoint: {endpoint}")
    return AzureOpenAI(azure_endpoint=endpoint, azure_ad_token_provider=token_provider,
                       api_version=api_version), endpoint


def upload(client, path) -> str:
    with path.open("rb") as fh:
        f = client.files.create(file=fh, purpose="fine-tune")
    # Azure imports the file asynchronously; the job can only reference it once
    # the import has completed (status 'processed').
    print(f"  uploaded {path.name} -> {f.id} (status: {f.status}); waiting for import", end="", flush=True)
    while f.status in ("pending", "running", "uploaded"):
        time.sleep(5)
        f = client.files.retrieve(f.id)
        print(".", end="", flush=True)
    print(f" {f.status}")
    if f.status not in ("processed", "succeeded"):
        raise SystemExit(f"File import failed for {path.name}: status={f.status}")
    return f.id


def deploy_finetuned(account: str, deployment: str, model_id: str, capacity: int) -> None:
    rg = os.environ.get("AZURE_RESOURCE_GROUP")
    if not rg:
        raise SystemExit("AZURE_RESOURCE_GROUP not set (run `azd env get-values`).")
    print(f"\nDeploying fine-tuned model as '{deployment}' on account '{account}'...")
    cmd = [
        "az", "cognitiveservices", "account", "deployment", "create",
        "-g", rg, "-n", account, "--deployment-name", deployment,
        "--model-name", model_id, "--model-version", "1", "--model-format", "OpenAI",
        "--sku-name", "Standard", "--sku-capacity", str(capacity),
    ]
    print("  " + " ".join(cmd))
    out = subprocess.run(cmd, capture_output=True, text=True, shell=os.name == "nt")
    if out.returncode != 0:
        raise SystemExit(f"Deployment failed:\n{out.stderr.strip()}")
    print(f"  deployed. Use deployment name '{deployment}' as the model in chat/Responses.")


def main() -> None:
    load_azd_env()
    for stray in ("AZURE_OPENAI_API_KEY", "OPENAI_API_KEY"):
        os.environ.pop(stray, None)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("agent_dir", help="agent name under ./agents (or a path) with agent.json")
    ap.add_argument("--model", default="gpt-4.1-mini", help="base model to fine-tune")
    ap.add_argument("--suffix", default=None, help="suffix for the fine-tuned model name")
    ap.add_argument("--api-version", default="2025-04-01-preview")
    ap.add_argument("--job", default=None, help="existing fine-tuning job id (skip upload/create)")
    ap.add_argument("--poll", action="store_true", help="wait for the job to finish")
    ap.add_argument("--deploy", action="store_true", help="deploy the fine-tuned model when done")
    ap.add_argument("--deploy-name", default=None, help="deployment name (default: <agent>-ft)")
    ap.add_argument("--capacity", type=int, default=1, help="deployment capacity (x1000 TPM)")
    args = ap.parse_args()

    agent_dir = resolve_agent_dir(args.agent_dir)
    cfg = load_agent_config(agent_dir)
    if not os.environ.get("FOUNDRY_PROJECT_ENDPOINT"):
        raise SystemExit("FOUNDRY_PROJECT_ENDPOINT is not set (run `azd env get-values`).")

    client, endpoint = _client(args.api_version)
    account = urlparse(endpoint).hostname.split(".")[0]

    if args.job:
        job_id = args.job
        print(f"Using existing job: {job_id}")
    else:
        sft_dir = agent_dir / "sft"
        train_path = sft_dir / "train.jsonl"
        val_path = sft_dir / "validation.jsonl"
        if not train_path.exists():
            raise SystemExit(f"{train_path} not found. Run build_sft_dataset.py {agent_dir.name} first.")
        print("Uploading SFT dataset...")
        train_id = upload(client, train_path)
        val_id = upload(client, val_path) if val_path.exists() else None

        print(f"Creating fine-tuning job (base model: {args.model})...")
        job = client.fine_tuning.jobs.create(
            model=args.model,
            training_file=train_id,
            validation_file=val_id,
            suffix=args.suffix or agent_dir.name[:18],
        )
        job_id = job.id
        print(f"  job id: {job_id}  (status: {job.status})")

    if not (args.poll or args.deploy):
        print("\nMonitor with:")
        print(f"  python finetune.py {agent_dir.name} --job {job_id} --poll")
        print("or in the Foundry portal under Fine-tuning.")
        return

    # Poll to completion.
    job = client.fine_tuning.jobs.retrieve(job_id)
    print("Polling job", end="", flush=True)
    while job.status not in TERMINAL:
        time.sleep(30)
        job = client.fine_tuning.jobs.retrieve(job_id)
        print(f" [{job.status}]", end="", flush=True)
    print()
    if job.status != "succeeded":
        raise SystemExit(f"Fine-tuning {job.status}. Inspect the job in the portal: {job_id}")

    model_id = job.fine_tuned_model
    print(f"Fine-tuned model: {model_id}")

    if args.deploy:
        deploy_finetuned(account, args.deploy_name or f"{agent_dir.name}-ft", model_id, args.capacity)
    else:
        print("\nDeploy it with:")
        print(f"  python finetune.py {agent_dir.name} --job {job_id} --deploy")


if __name__ == "__main__":
    main()
