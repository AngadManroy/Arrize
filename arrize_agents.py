"""
Create and test Arrize's three AgenticOrg agents.

Setup:
    pip install agenticorg==0.4.0
    export AGENTICORG_API_KEY=...       # from the AgenticOrg dashboard
    export AGENTICORG_COMPANY_ID=...    # your company / tenant UUID
    export AGENTICORG_BASE_URL=...      # only if your hackathon tenant is not the SDK default

Usage:
    python arrize_agents.py create --dry-run   # print what would be sent, no API calls
    python arrize_agents.py create             # parse each SOP, deploy as a shadow agent, save ids
    python arrize_agents.py test               # run every agent once on a sample input

New agents start in shadow. Promote them in the AgenticOrg dashboard after the
test runs look right; the SDK has no promote call.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

AGENTS_FILE = Path(__file__).with_name("agents.json")

# ---------------------------------------------------------------------------
# Agent definitions: one SOP per agent, plus the settings we force on the
# draft config before deploying it.
# ---------------------------------------------------------------------------

GOAL_INTAKE_SOP = """
Role: Goal Intake agent for Arrize, a learning app that turns a goal into daily quests.
Input: the finished onboarding chat transcript between the learner and the in-app coach.

Step 1: Extract the learning goal, the deadline (ISO date) and the minutes per day the learner can give.
Step 2: Extract up to 3 tracks (sub-skills) and rank them by how directly they serve the goal.
Step 3: Draft the first day's quests: 4 to 6 quests, each with title, track, type
        (tick, counter or entry), target, unit and EXP. At least one must be a learning
        quest that can be checked with a 3-question quiz.
Step 4: If the goal, deadline or daily time is missing or unrealistic, set needs_followup
        to true and list the questions the coach should ask next.
Step 5: Return JSON only, with keys: goal, deadline, daily_minutes, tracks,
        first_day_quests, needs_followup, followup_questions.
"""

QUEST_PLANNER_SOP = """
Role: Progress and Quest Planner for Arrize. Runs once per learner at the 06:00 IST day reset.
Input: the learner's goal and deadline, active tracks with priority, and the last 7 days of quest logs.

Step 1: Compute days logged in the last 7 days and the average clear rate.
Step 2: Diagnose one of: on_track, scattered, stalled, coasting.
        scattered = fewer than 3 days logged or clear rate under 40% while more than 2 tracks are active.
        stalled   = the same quests repeated for 14 days with no rise in quiz scores.
        coasting  = clear rate above 90% for 7 days.
Step 3: If scattered, keep the top-priority track plus at most one more and pause the rest.
        If coasting, raise counter targets by about 20%. If stalled, swap in new quest types.
Step 4: Write tomorrow's 4 to 6 quests (title, track, type, target, unit, EXP, verifiable).
        At least one must be a verifiable learning quest.
Step 5: Write a two-sentence message to the learner explaining the change.
Step 6: Escalate to a human if 2 or more tracks would be paused or the main goal would change.
Step 7: Return JSON only, with keys: diagnosis, reasons, track_changes,
        quests_for_tomorrow, message_to_user.
"""

DEATH_QUEST_SOP = """
Role: Death Quest Validator for Arrize. Decides whether a must-do quest was completed.
Input: the quest (title, type, target, deadline, proof type), the pledge amount and charity,
the learner's submission (text entry, quiz answers, URL or commit) and whether they dispute.

Step 1: If nothing was submitted before the deadline, the verdict is fail.
Step 2: Quiz proof passes if at least 2 of 3 answers match the expected answers in meaning.
Step 3: Text proof passes if it meets the target length, is on the quest topic and is not
        a copy of the quest description.
Step 4: URL or commit proof passes if its timestamp is inside the quest window and its
        content matches the quest.
Step 5: Recommend refund on pass, forfeit on fail, ask_for_more_proof if unclear.
Step 6: Escalate to a human for every forfeit, any pledge above Rs 200, confidence below 0.85,
        or any dispute.
Step 7: Return JSON only, with keys: verdict, confidence, reasons, recommended_action.
"""

AGENTS = {
    "goal_intake": {
        "name": "Arrize - Goal Intake",
        "domain": "ops",
        "sop": GOAL_INTAKE_SOP,
        "confidence_floor": 0.70,
        "hitl_condition": "needs_followup == true",
    },
    "quest_planner": {
        "name": "Arrize - Progress and Quest Planner",
        "domain": "ops",
        "sop": QUEST_PLANNER_SOP,
        "confidence_floor": 0.75,
        "hitl_condition": "paused_tracks >= 2 OR goal_changed == true",
    },
    "death_quest_validator": {
        "name": "Arrize - Death Quest Validator",
        "domain": "finance",
        "sop": DEATH_QUEST_SOP,
        "confidence_floor": 0.85,
        "hitl_condition": (
            "recommended_action == 'forfeit' OR amount_inr > 200 OR user_disputed == true"
        ),
    },
}

# Sample inputs for the shadow test runs.
SAMPLES = {
    "goal_intake": {
        "transcript": [
            {"role": "learner", "text": "I want to hold a basic conversation in Kannada."},
            {"role": "coach", "text": "By when, and how much time can you give each day?"},
            {"role": "learner", "text": "In 14 days. About 30 minutes a day, mostly evenings."},
        ]
    },
    "quest_planner": {
        "goal": {"title": "Conversational Kannada", "deadline": "2026-11-07", "daily_minutes": 30},
        "tracks": [
            {"id": "t1", "name": "Auto and market phrases", "priority": 1},
            {"id": "t2", "name": "Numbers and bargaining", "priority": 2},
            {"id": "t3", "name": "Kannada script", "priority": 3},
            {"id": "t4", "name": "Film songs", "priority": 4},
        ],
        "last_7_days": [
            {"day_key": "2026-10-18", "cleared": 1, "total": 6},
            {"day_key": "2026-10-21", "cleared": 2, "total": 6},
        ],
    },
    "death_quest_validator": {
        "quest": {
            "id": "dq_42",
            "title": "Learn 10 auto-ride phrases",
            "type": "entry",
            "deadline": "2026-10-24T18:00:00+05:30",
            "proof_type": "quiz",
        },
        "pledge": {"amount_inr": 49, "charity": "Akshaya Patra"},
        "submission": {
            "submitted_at": "2026-10-24T17:20:00+05:30",
            "quiz": [
                {"q": "How do you say 'go straight'?", "expected": "nera hogi", "answer": "nera hogi"},
                {"q": "How do you say 'stop here'?", "expected": "illi nillisi", "answer": "illi nillsi"},
                {"q": "How do you ask 'how much?'", "expected": "eshtu", "answer": "yeshtu"},
            ],
        },
        "user_disputed": False,
        "amount_inr": 49,
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_client():
    from agenticorg import AgenticOrg  # imported here so --dry-run needs no install

    return AgenticOrg(
        api_key=os.getenv("AGENTICORG_API_KEY"),
        base_url=os.getenv("AGENTICORG_BASE_URL") or None,
    )


def company_id() -> str:
    cid = os.getenv("AGENTICORG_COMPANY_ID", "")
    if not cid:
        sys.exit("Set AGENTICORG_COMPANY_ID to your company UUID first.")
    return cid


def explain_http_error(err: Exception) -> str:
    resp = getattr(err, "response", None)
    if resp is None:
        return str(err)
    return f"HTTP {resp.status_code}: {resp.text[:800]}"


def overrides_for(agent_type: str, spec: dict, cid: str) -> dict:
    return {
        "name": spec["name"],
        "agent_type": agent_type,
        "domain": spec["domain"],
        "company_id": cid,
        "confidence_floor": spec["confidence_floor"],
        "hitl_condition": spec["hitl_condition"],
        "authorized_tools": [],  # our backend owns DB writes and Pine Labs calls
        "initial_status": "shadow",
    }


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_create(dry_run: bool) -> None:
    cid = os.getenv("AGENTICORG_COMPANY_ID", "<company-uuid>") if dry_run else company_id()
    client = None if dry_run else make_client()
    created: dict[str, str] = {}

    for agent_type, spec in AGENTS.items():
        overrides = overrides_for(agent_type, spec, cid)
        print(f"\n=== {spec['name']} ===")

        if dry_run:
            print("POST /api/v1/sop/parse-text  domain_hint =", spec["domain"])
            print("then POST /api/v1/sop/deploy with the draft config plus:")
            print(json.dumps(overrides, indent=2))
            continue

        try:
            draft = client.sop.parse_text(spec["sop"], domain_hint=spec["domain"])
            config = dict(draft.get("config", draft))
            print("Draft config keys from the SOP parser:", sorted(config.keys()))
            config.update(overrides)
            agent = client.sop.deploy(config)
        except Exception as err:  # SOP route unavailable or rejected: fall back to direct create
            print("SOP deploy failed ->", explain_http_error(err))
            print("Falling back to agents.create with the SOP as the description.")
            try:
                agent = client.agents.create(description=spec["sop"].strip(), **overrides)
            except Exception as err2:
                print("Direct create failed too ->", explain_http_error(err2))
                print("Create this one in the dashboard and paste its id into agents.json.")
                continue

        agent_id = agent.get("agent_id") or agent.get("id")
        status = agent.get("status") or agent.get("initial_status")
        print(f"Created {agent_id} (status: {status})")
        if agent_id:
            created[agent_type] = agent_id

    if not dry_run and created:
        existing = json.loads(AGENTS_FILE.read_text()) if AGENTS_FILE.exists() else {}
        existing.update(created)
        AGENTS_FILE.write_text(json.dumps(existing, indent=2))
        print(f"\nSaved agent ids to {AGENTS_FILE}")


def cmd_test() -> None:
    if not AGENTS_FILE.exists():
        sys.exit("No agents.json yet. Run `python arrize_agents.py create` first.")
    ids = json.loads(AGENTS_FILE.read_text())
    client = make_client()
    cid = company_id()

    for agent_type, agent_id in ids.items():
        print(f"\n=== {agent_type} ({agent_id}) ===")
        try:
            result = client.agents.run(
                agent_id, action="process", inputs=SAMPLES[agent_type], company_id=cid
            )
        except Exception as err:
            print("Run failed ->", explain_http_error(err))
            continue
        print("status:     ", result.status)  # completed | failed | hitl_triggered | budget_exceeded
        print("confidence: ", result.confidence)
        print("hitl:       ", result.hitl_trigger)
        print("output:     ", json.dumps(result.output, indent=2)[:1500])


# ---------------------------------------------------------------------------
# What your backend calls at a death quest deadline
# ---------------------------------------------------------------------------

def settle_death_quest(client, agent_id: str, cid: str, payload: dict) -> dict:
    """Run the validator and return what the backend should do next.

    Only a confident pass is refunded automatically. Everything else waits for a
    human decision in the AgenticOrg dashboard before any money moves.
    """
    result = client.agents.run(agent_id, action="process", inputs=payload, company_id=cid)
    out = result.output or {}

    if result.status == "completed" and out.get("recommended_action") == "refund":
        return {"next": "refund_now", "run_id": result.run_id, "reasons": out.get("reasons")}
    if result.status == "hitl_triggered":
        return {"next": "await_human", "run_id": result.run_id, "trigger": result.hitl_trigger}
    if out.get("recommended_action") == "ask_for_more_proof":
        return {"next": "ask_learner", "run_id": result.run_id, "reasons": out.get("reasons")}
    return {"next": "await_human", "run_id": result.run_id, "status": result.status}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create", help="Deploy the three agents as shadow agents")
    create.add_argument("--dry-run", action="store_true", help="Print payloads without calling the API")
    sub.add_parser("test", help="Run each agent once on a sample input")
    args = parser.parse_args()

    if args.command == "create":
        cmd_create(args.dry_run)
    else:
        cmd_test()


if __name__ == "__main__":
    main()
