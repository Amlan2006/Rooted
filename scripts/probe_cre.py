"""Run only the Phase 1 HTTP + EVM CRE simulation, never broadcast."""
import shutil
import subprocess
import probe_common as common


def main():
    cre, bun = shutil.which('cre'), shutil.which('bun')
    if not cre or not bun:
        raise common.ProbeError('cre_or_bun_not_installed')
    project = common.ROOT / 'integrations' / 'cre' / 'probe'
    command = [cre, 'workflow', 'simulate', './workflow', '--project-root', '.',
        '--target', 'capability-settings', '--trigger-index', '0', '--non-interactive']
    try:
        result = subprocess.run(command, cwd=project, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        raise common.ProbeError('cre_simulation_timeout') from None
    output = result.stdout + result.stderr
    # Retain known public outcomes only; CLI diagnostic strings can contain secrets.
    values = {'cli_exit_code': result.returncode, 'http_value_verified': 'HTTP_VALUE=4' in output,
        'evm_tick_spacing_verified': 'EVM_TICK_SPACING=10' in output,
        'execution_mode': 'simulation', 'broadcast': False}
    common.save('simulation', values)
    if 'Authentication required' in output or 'not logged in' in output:
        raise common.ProbeError('cre_authentication_required')
    if result.returncode or not all((values['http_value_verified'], values['evm_tick_spacing_verified'])):
        raise common.ProbeError('cre_simulation_did_not_verify_http_and_evm')
    return values


if __name__ == '__main__':
    raise SystemExit(common.run('cre', main))
