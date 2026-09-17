export const config = {
  runtime: 'edge',
};

const handler = async (req: Request): Promise<Response> => {
  const models = [
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B (Groq)',
      maxLength: 12000,
      tokenLimit: 4000,
    },
  ];

  return new Response(JSON.stringify(models), { status: 200 });
};

export default handler;
