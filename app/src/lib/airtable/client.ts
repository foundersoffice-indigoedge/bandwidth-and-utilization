const BASE_URL = 'https://api.airtable.com/v0';

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
}

export async function fetchAllRecords(
  tableId: string,
  params: Record<string, string> = {}
): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(`${BASE_URL}/${process.env.AIRTABLE_BASE_ID}/${tableId}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Airtable ${tableId}: ${res.status} ${await res.text()}`);

    const data: AirtableListResponse = await res.json();
    all.push(...data.records);
    offset = data.offset;
  } while (offset);

  return all;
}

export async function updateRecord(
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/${process.env.AIRTABLE_BASE_ID}/${tableId}/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  );
  if (!res.ok) throw new Error(`Airtable update ${recordId}: ${res.status} ${await res.text()}`);
}
