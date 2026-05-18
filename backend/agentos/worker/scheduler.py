import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from arq import create_pool
from arq.connections import RedisSettings
from sqlmodel import Session, select, delete

from ..config import settings
from ..database import engine
from ..models import Schedule, Run, LogEntry, RunStatus

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def _fire_schedule(schedule_id: str) -> None:
    with Session(engine) as session:
        schedule = session.get(Schedule, schedule_id)
        if not schedule or not schedule.enabled:
            return

        run = Run(
            agent_id=schedule.agent_id,
            schedule_id=schedule_id,
            input_params=schedule.input_params,
            triggered_by="schedule",
        )
        session.add(run)
        schedule.last_run_at = datetime.utcnow()
        session.add(schedule)
        session.commit()
        session.refresh(run)
        run_id = run.id

    pool = await create_pool(_redis_settings())
    await pool.enqueue_job("run_agent_task", run_id)
    await pool.aclose()


async def _cleanup_old_logs() -> None:
    cutoff = datetime.utcnow() - timedelta(days=settings.log_retention_days)
    with Session(engine) as session:
        old_runs = session.exec(
            select(Run.id).where(
                Run.finished_at < cutoff,
                Run.status.in_([RunStatus.success, RunStatus.failed, RunStatus.cancelled]),
            )
        ).all()
        if not old_runs:
            return
        deleted = session.exec(
            delete(LogEntry).where(LogEntry.run_id.in_(old_runs))
        ).rowcount
        session.commit()
    if deleted:
        logger.info("Log retention: deleted %d LogEntry records older than %d days", deleted, settings.log_retention_days)


async def start_scheduler() -> None:
    with Session(engine) as session:
        schedules = session.exec(select(Schedule).where(Schedule.enabled == True)).all()
    for schedule in schedules:
        add_schedule(schedule)

    # Daily log cleanup at 3am
    _scheduler.add_job(
        _cleanup_old_logs,
        CronTrigger(hour=3, minute=0),
        id="log_retention_cleanup",
        replace_existing=True,
    )

    _scheduler.start()


async def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def add_schedule(schedule: Schedule) -> None:
    job_id = f"schedule_{schedule.id}"
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)
    if schedule.enabled:
        _scheduler.add_job(
            _fire_schedule,
            CronTrigger.from_crontab(schedule.cron_expression),
            id=job_id,
            args=[schedule.id],
            replace_existing=True,
        )


def remove_schedule(schedule_id: str) -> None:
    job_id = f"schedule_{schedule_id}"
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


def update_schedule(schedule: Schedule) -> None:
    remove_schedule(schedule.id)
    add_schedule(schedule)
