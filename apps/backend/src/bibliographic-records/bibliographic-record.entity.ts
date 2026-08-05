import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('bibliographic_record')
@Unique(['isbn'])
export class BibliographicRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  title!: string;

  @Column({ type: 'varchar', nullable: true })
  author!: string | null;

  @Column({ type: 'varchar', nullable: true })
  publisher!: string | null;

  @Column({ type: 'varchar', nullable: true })
  isbn!: string | null;

  @Column({ type: 'varchar', nullable: true })
  category!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}