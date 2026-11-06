CREATE INDEX xray_reports_uniswap ON xray_reports(network,block_number DESC) WHERE (report->'uniswap'->>'labeled_edges')::int>0;
