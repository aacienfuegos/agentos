from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from arq import create_pool
from arq.connections import RedisSettings
from sqlmodel import Session, select

from ..config import settings
from ..database import engine
from ..models import Schedule, Run

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


async def start_scheduler() -> None:
    with Session(engine) as session:
        schedules = session.exec(select(Schedule).where(Schedule.enabled == True)).all()
    for schedule in schedules:
        add_schedule(schedule)
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
